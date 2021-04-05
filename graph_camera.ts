/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {EventEmitter} from '@angular/core';
import {fromEvent, Subscription} from 'rxjs';
import {debounceTime} from 'rxjs/operators';

import {Node, Point, Rect} from './model';
import {WindowRef} from './window/window_module';

// taze: SvgPanZoom.Instance from //third_party/javascript/typings/svg_pan_zoom

/**
 * When the graph is too big to fit within the camera frame, we automatically
 * zoom out so the graph can fit. When this happens, the default behavior of the
 * pan-zoom library is for the graph elements to become flush with the edges of
 * the canvas, an effect that is quite unpleasant. To handle this, we adjust the
 * zoom level by an additional percent amount: zooming out just a little bit
 * more to add padding around the edges.
 */
const FIT_PADDING_PERCENT = .04;

/**
 * The amount of time to debounce window resize events before refreshing the
 * pan-zoom settings for the graph.
 */
const DEBOUNCE_RESIZE_EVENTS_MS = 200;

/**
 * A modifier for how sensitive zoom in/out step increments should be.
 */
const ZOOM_SENSITIVITY = 0.4;

/**
 * A special zoom sensitivity for OSX. SVG-PanZoom is particulary sensitive
 * to scroll events on this OS.
 */
const MAC_ZOOM_SENSITIVITY = 0.09;

/**
 * A number of units of extra padding (in world space) to apply between the
 * edge of the camera and the region when panning that region into view.
 */
const PAN_INTO_VIEW_PADDING = 60;


/**
 * A camera for the graph that adds support for panning, zooming, and
 * converting between coordinate spaces.
 *
 * Conceptually, you can think of the svg canvas as a window or lens through
 * which the user is viewing the graph. This graph could be much larger than
 * can fit within the window normally, requiring us to zoom out or pan so
 * they can view it all.
 *
 * Internally, this class wraps the third-party SvgPanZoom library.
 *
 * Coordinate spaces:
 * +++++++++++++++++++++++++++++++
 * Coordinate spaces in this context refer to a set of (x,y) coordinates that
 * are relative to a given origin (0,0). A single point on the user's screen may
 * be represented by different (x,y) values depending on what coordinate space
 * is being used. For example, a point may be (50,50) in DOM space, (0,0)
 * in Camera space, and (-200, 50) in World Space simultaneously.
 *
 * APIs expect values in particular coordinate spaces, so it is important to
 * know which one you are using or you may get unintenteded behavior.
 *
 * The camera uses 3 coordinate spaces, all of them using an inverted y-axis
 * (-y = up, +y = down)
 *
 * - DOM Space
 *   The origin is the top-left corner of the browser window. Mouse events
 *   have clientX and clientY positions that are in DOM space.
 *   1 unit = 1 pixel
 *
 * - Camera Space
 *   The origin is the top-left corner of the svg canvas and the width and
 *   height are the dimensions of the svg element. This is the visible window
 *   that the user is looking through. Panning and zooming APIs expect values
 *   in camera space (eg, "pan 50 to the right")
 *   1 unit = 1 pixel
 *
 * - World Space
 *   This is a boundless, 2d plane that the graph nodes and edges are plotted
 *   on. Coordinates are arbitrary and the camera will center and fit so
 *   that all contents of world space are initially visible. Our layout
 *   algorithm currently assigns the origin to be the top left corner of an
 *   axis-aligned bounding box around all nodes. On initialization, the camera
 *   will try to honor a 1-to-1 ratio where 1 unit in world space = 1 pixel, but
 *   this may be lost if it needs to zoom out to fit the contents.
 *   1 unit = ?? pixel
 */
export class GraphCamera {
  /**
   * The canvas element that represents the camera window.
   */
  private svgEl: SVGElement;

  /**
   * PanZoom library instance that can apply transforms to the svg canvas.
   */
  private panZoom: SvgPanZoom.Instance;

  /**
   * Internal subscription to the browser window to listen for resize events.
   */
  private resizeSub?: Subscription;
  /**
   * A fn that can stop an active smooth pan animation.
   */
  private stopSmoothPanFn = () => {};

  /**
   * A fn that can any active smooth zoom animation.
   */
  private stopSmoothZoomFn = () => {};

  private stopSmoothPanAndZoomFn = () => {};

  /**
   * Emits an event whenever the camera is panned.
   */
  onPan = new EventEmitter<Point>();

  constructor(options: CameraOptions) {
    this.svgEl = options.svgEl;
    const viewportEl = this.svgEl.querySelector('g');

    if (!viewportEl) {
      throw new ReferenceError(
          'A root <g> element is needed for the camera to work.');
    }
    const isMac = navigator.userAgent.includes('Macintosh');

    // Setup the svgPanZoom library.
    // Note: We cannot use 'fit' or 'contain' to re-position the graph in the
    // initial constructor due to a quirk in the pan zoom library. The library
    // defines zoom level 1 to be whatever the svg looks like AFTER it applies
    // the initial fit and contain. However, we want 'zoom level 1' to be the
    // regular size, so we are forced to perform all fit calculations after
    // construction.
    this.panZoom = svgPanZoom(this.svgEl, {
      viewportSelector: viewportEl!,
      fit: false,
      contain: false,
      center: true,
      zoomScaleSensitivity: isMac ? MAC_ZOOM_SENSITIVITY : ZOOM_SENSITIVITY,
      mouseWheelZoomEnabled: options.mouseWheelZoomEnabled,
      panEnabled: true,
      minZoom: 0.1,
      maxZoom: 2,
      preventMouseEventsDefault: false,
      beforePan: ((oldPoint, point) => {
        // Round down pan values to the nearest pixel. This helps remove some
        // anti-aliasing for graphs that don't need to be zoomed out to see
        // everything.
        return {
          x: Math.round(point.x),
          y: Math.round(point.y),
        };
      }),
      onPan: ((point) => {
        this.onPan.next(point);
      }),
    });


    this.reset();

    if (!!options.autoResetOnWindowResize) {
      if (!options.windowRef) {
        throw new ReferenceError(
            'windowRef is required for autoresize');
      }
      this.resizeSub = fromEvent(options.windowRef!.native, 'resize')
                           .pipe(debounceTime(DEBOUNCE_RESIZE_EVENTS_MS))
                           .subscribe(() => {
                             this.reset();
                           });
    }
  }

  /**
   * Destroys the camera and cleans up resources.
   */
  destroy() {
    if (this.resizeSub) this.resizeSub.unsubscribe();
    this.stopSmoothPanFn();
    this.stopSmoothZoomFn();
    this.onPan.complete();
    this.panZoom.destroy();
  }

  /**
   * Resets the camera to a default view where the entire graph is visible and
   * centered.
   */
  reset() {
    this.stopSmoothPanFn();
    this.stopSmoothZoomFn();
    this.panZoom.updateBBox();
    this.panZoom.resize();
    this.panZoom.center();
    this.fitWithoutZoomingIn();
  }

  smoothReset(durationMs: number) {
    this.stopSmoothPanFn();
    this.stopSmoothZoomFn();
    this.panZoom.updateBBox();
    this.panZoom.resize();
    this.smoothCenterAndFitWithoutZoomingIn(durationMs);
  }

  /**
   * Zooms the camera in by one step.
   */
  zoomIn() {
    const existing = this.panZoom.getZoom();
    const scale = 1 + ZOOM_SENSITIVITY;
    const target = existing * scale;
    this.smoothZoom(target);
  }

  /**
   * Zooms the camera out by one step.
   */
  zoomOut() {
    const existing = this.panZoom.getZoom();
    const scale = 1 / (1 + ZOOM_SENSITIVITY);
    const target = existing * scale;
    this.smoothZoom(target);
  }

  /**
   * Returns the x/y amount that the canvas has been panned by.
   */
  getPan() {
    return this.panZoom.getPan();
  }

  /**
   * Returns the zoom magnification.
   */
  getZoom() {
    return this.panZoom.getZoom();
  }

  /**
   * Pans to the specified point in camera space.
   */
  pan(point: Point) {
    this.panZoom.pan(point);
  }

  /**
   * Sets the zoom magnification.
   */
  zoom(zoomLevel: number) {
    this.panZoom.zoom(zoomLevel);
  }

  /**
   * Smoothly pans to the specified point in camera space using an animation.
   */
  smoothPan(point: Point, durationMs = 250) {
    this.stopSmoothPanFn();

    const startX = this.panZoom.getPan().x;
    const startY = this.panZoom.getPan().y;
    const panByX = point.x - startX;
    const panByY = point.y - startY;

    this.stopSmoothPanFn = animateOver(durationMs, (progress) => {
      const targetX = startX + (progress * panByX);
      const targetY = startY + (progress * panByY);
      this.panZoom.pan({x: targetX, y: targetY});
    });
  }

  /**
   * Smoothly zooms to the requested magnification level using an animation.
   */
  smoothZoom(zoomLevel: number, durationMs = 250) {
    this.stopSmoothZoomFn();

    const startZoom = this.panZoom.getZoom();
    const zoomBy = zoomLevel - startZoom;

    this.stopSmoothZoomFn = animateOver(durationMs, (progress) => {
      const targetZoom = startZoom + (progress * zoomBy);
      this.panZoom.zoom(targetZoom);
    });
  }

  /**
   * Performs smooth pan and smooth zoom simultaneously using an animation.
   */
  smoothPanAndZoom(point: Point, zoomLevel: number, durationMs = 250) {
    this.stopSmoothPanAndZoomFn();

    const startX = this.panZoom.getPan().x;
    const startY = this.panZoom.getPan().y;
    const panByX = point.x - startX;
    const panByY = point.y - startY;

    const startZoom = this.panZoom.getZoom();
    const zoomBy = zoomLevel - startZoom;

    this.stopSmoothPanAndZoomFn = animateOver(durationMs, (progress) => {
      const targetX = startX + (progress * panByX);
      const targetY = startY + (progress * panByY);
      this.panZoom.pan({x: targetX, y: targetY});

      const targetZoom = startZoom + (progress * zoomBy);
      this.panZoom.zoom(targetZoom);
    });
  }

  /**
   * Smoothly pans a node into view by the minimal amount necessary to make it
   * fully visible. Accepts optional padding to apply to the edges of the camera
   * region.
   */
  panNodeIntoView(node: Node, padding = PAN_INTO_VIEW_PADDING) {
    this.panIntoView(nodeToRect(node), padding);
  }

  /**
   * Smoothly pans a rectangle in world space into view by the minimal amount
   * necessary to make it fully visible. Accepts optional padding to apply
   * to the edges of the camera region.
   */
  panIntoView(region: Rect, padding = PAN_INTO_VIEW_PADDING) {
    // Ensure svgPanZooms cached sizes are correct.
    this.panZoom.updateBBox();
    this.panZoom.resize();

    const visibleRegion = this.getVisibleRegionInWorldSpace();
    region = expandRectBy(region, padding);
    let xToPan = 0;
    let yToPan = 0;

    // Top of region is above the top of the visible region: pan down
    if (region.top < visibleRegion.top) {
      yToPan = visibleRegion.top - region.top;
    }

    // Bottom of region is below the bottom visible region: pan up
    if (region.bottom > visibleRegion.bottom) {
      yToPan = visibleRegion.bottom - region.bottom;
    }

    // Left of region is beyond the left of visible region: pan right
    if (region.left < visibleRegion.left) {
      xToPan = visibleRegion.left - region.left;
    }

    // Right of region is beyond the right of visible region: pan left
    if (region.right > visibleRegion.right) {
      xToPan = visibleRegion.right - region.right;
    }

    // Already visible?
    if (xToPan === 0 && yToPan === 0) {
      return;
    }

    // At this point we've calculated the amount we need to pan in world
    // space. However, the camera APIs expect values in camera space. We need
    // to convert back by scaling by the zoom factor.
    const zoom = this.panZoom.getZoom();
    const amountToPanByInCameraSpace = {
      x: xToPan * zoom,
      y: yToPan * zoom,
    };

    // Convert 'panBy' to an absolute value to pan to
    const currentPan = this.panZoom.getPan();
    const targetPan = {
      x: currentPan.x + amountToPanByInCameraSpace.x,
      y: currentPan.y + amountToPanByInCameraSpace.y,
    };

    this.smoothPan(targetPan);
  }

  /**
   * Ensure that the graph fits within the bounds of the svg by zooming
   * out until it is visible.
   *
   * This differs from the regular 'fit' method, which will both zoom-in and
   * zoom-out to ensure the graph fills the screen. We don't want the zoom-in
   * behavior, which makes small graphs too large on the screen.
   */
  private fitWithoutZoomingIn() {
    this.panZoom.fit();
    if (this.panZoom.getZoom() > 1) {
      this.panZoom.zoom(1);
    } else {
      const currentZoom = this.panZoom.getZoom();
      const zoomAdjustedForPadding = currentZoom * (1 - FIT_PADDING_PERCENT);
      this.panZoom.zoom(zoomAdjustedForPadding);
    }
  }

  /**
   * Has same final result with doing
   * ```
   * this.panZoom.center();
   * this.fitWithoutZoomingIn();
   * ```
   * but performs centering and fitting smoothly during `durationMs`.
   *
   * Calculation of `newZoom` and `newPan` is referred from
   * https://github.com/ariutta/svg-pan-zoom/blob/master/src/svg-pan-zoom.js
   * `SvgPanZoom.prototype.fit`, `SvgPanZoom.prototype.center`.
   */
  private smoothCenterAndFitWithoutZoomingIn(durationMs: number) {
    const sizes = (this.panZoom as SvgPanZoomWithSizes).getSizes();

    let newZoom = Math.min(
        sizes.width / sizes.viewBox.width, sizes.height / sizes.viewBox.height);
    if (newZoom > 1) {
      newZoom = 1;
    } else {
      newZoom = newZoom * (1 - FIT_PADDING_PERCENT);
    }

    const offsetX =
        (sizes.width - (sizes.viewBox.width + sizes.viewBox.x * 2) * newZoom) *
        0.5;
    const offsetY = (sizes.height -
                     (sizes.viewBox.height + sizes.viewBox.y * 2) * newZoom) *
        0.5;
    const newPan = {x: offsetX, y: offsetY};

    this.smoothPanAndZoom(newPan, newZoom, durationMs);
  }

  /**
   * Converts DOM coordinates to coordinates within the graph.
   */
  domToWorldSpace(point: Point) {
    const cameraPoint = this.domToCameraSpace(point);
    return this.cameraToWorldSpace(cameraPoint);
  }

  private domToCameraSpace(point: Point): Point {
    const svgBounds = this.svgEl.getBoundingClientRect();
    return {
      x: point.x - svgBounds.left,
      y: point.y - svgBounds.top,
    };
  }

  private cameraToWorldSpace(point: Point) {
    const zoom = this.panZoom.getZoom();
    const pan = this.panZoom.getPan();
    const x = (point.x - pan.x) / zoom;
    const y = (point.y - pan.y) / zoom;
    return {x, y};
  }

  /**
   * Returns the rectangular region of world space that is currently visible.
   */
  private getVisibleRegionInWorldSpace(): Rect {
    // The typings for SvgPanZoom are missing the getSizes() call
    // For now we cast to a custom type with the appropriate methods.
    const sizes = (this.panZoom as SvgPanZoomWithSizes).getSizes();
    const topLeft = this.cameraToWorldSpace({x: 0, y: 0});
    const bottomRight = this.cameraToWorldSpace({
      x: sizes.width,
      y: sizes.height,
    });

    return {
      top: topLeft.y,
      left: topLeft.x,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
  }
}

/**
 * Converts a node into a rectangle.
 */
function nodeToRect(node: Node): Rect {
  const left = node.x! - node.width / 2;
  const right = node.x! + node.width / 2;
  const top = node.y! - node.height / 2;
  const bottom = node.y! + node.height / 2;
  return {top, left, right, bottom};
}

/**
 * Returns a new rectangle that is expanded outward in every direction by the
 * specified amount.
 */
function expandRectBy(region: Rect, amount: number) {
  const expanded = {...region};
  expanded.top -= amount;
  expanded.left -= amount;
  expanded.right += amount;
  expanded.bottom += amount;
  return expanded;
}

/**
 * Ease in and out - Start slow, speed up, then slow down.
 * @param {number} t Input between 0 and 1.
 * @return {number} Output between 0 and 1.
 */
function easeInAndOut(t: number): number {
  return 3 * t * t - 2 * t * t * t;
}

/**
 * A utility method for animations that will invoke a callback every
 * frame with the % progress (eg .8) that the animation should be complete,
 * given the animation should last the specified duration. It is up to the
 * callback method to make any needed change.
 *
 * Returns a stopFn called stop the animation early.
 */
function animateOver(
    durationMs: number,
    callback: (progress: number) => void,
    ): () => void {
  const start = Date.now();
  let handle: number|undefined;  // handle to stop an animation

  // Note: normally we could take a high-precision timestamp as a parameter
  // to the animation frameFn, however, either catalyst or zone.js breaks
  // this behavior in some environments and passes a fn instead of a number.
  // To be safe, we call DateTime.now() directly.
  const frameFn = () => {
    // Determine how much time has passed as a percent value.
    const progressMs = Date.now() - start;
    let progress = Math.min(progressMs / durationMs, 1);

    // Apply an easing fn to smooth the animation.
    progress = easeInAndOut(progress);

    // Invoke the callback to make any dom changes.
    callback(progress);

    // Schedule the next frame.
    if (progressMs < durationMs) {
      handle = requestAnimationFrame(frameFn);
    } else {
      handle = undefined;
    }
  };

  handle = requestAnimationFrame(frameFn);

  const stopFn = () => {
    if (handle) {
      cancelAnimationFrame(handle);
      handle = undefined;
    }
  };

  return stopFn;
}

/**
 * Additional options to configure the camera.
 */
export interface CameraOptions {
  /**
   * The SVG canvas that will act as the camera viewport.
   */
  svgEl: SVGElement;

  /**
   * A reference to the window. Must be set when using autoResetOnWindowResize.
   */
  windowRef?: WindowRef;

  /**
   * When true, the camera will automatically recenter and fit the graph
   * when the browser window is resized.
   */
  autoResetOnWindowResize?: boolean;

  /** When true, the camera will zoom in or out based on the scrolling input. */
  mouseWheelZoomEnabled?: boolean;
}

/**
 * Hepler to allow us to call getSizes on the SvgPanZoom object. This can be
 * removed if the svgPanZoom typings file is updated.
 */
declare interface SvgPanZoomWithSizes extends SvgPanZoom.Instance {
  getSizes(): SizesProvided;
}

declare interface SizesProvided {
  width: number;
  height: number;
  realZoom: number;
  viewBox: {x: number, y: number, width: number, height: number};
}
