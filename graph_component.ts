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

import {DOCUMENT} from '@angular/common';
import {AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ContentChild, ElementRef, EventEmitter, HostListener, Inject, Input, OnChanges, OnDestroy, Output, TemplateRef, ViewChild} from '@angular/core';
import {GraphLabel, graphlib, layout} from 'dagre';
import {fromEvent, Subscription} from 'rxjs';

import {GraphCamera} from './graph_camera';
import {Edge, Graph, GraphCreateEvent, GraphDeleteEvent, GraphSelectEvent, LayoutOptions, Node, Point, RankAlignment, RankDirection, RankerAlgorithim} from './model';
import {curvedPath} from './paths';
import {WindowRef} from './window/window_module';

/**
 * Default layout options to use.
 */
const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  rankDirection: RankDirection.TOP_TO_BOTTOM,
  rankAlignment: RankAlignment.NONE,
  ranker: RankerAlgorithim.NETWORK_SIMPLEX,
  edgeSeparation: 0,
  rankSeparation: 40,
  nodeSeparation: 20,
};

/**
 * Size for the drag node cursor during graph editing.
 *
 * TODO(b/168292089): Make this configurable
 */
const DEFAULT_NODE_SIZE = 38;

/**
 * Keystrokes that will delete the currently selected node or edge.
 *
 * These are a subset of possible values for KeyboardEvent.key, see
 * https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values
 */
const DELETE_DOM_STRINGS = [
  'Delete',
  'Backspace',
];

/**
 * Enum to provide camera reset behavior options on graph set.
 */
export enum CameraResetBehaviorEnum {
  RESET,
  SMOOTH_RESET,
  NONE,
}

/**
 * Renders an svg graph of nodes connected by edges.
 *
 * By default, each node is rendered as a box, while curved lines connect
 * them. This can be customized by supplying custom edge and node templates
 * to the component.
 *
 * Data is expected to be supplied to the graph as basic 'Node' and 'Edge'
 * objects (see graph_models.ts). These interfaces may be optionally
 * parameterized to wrap custom data specific to you graph. Node and Edge
 * ojbects are passed to custom templates so you may access your custom
 * data in your templates.
 *
 * Example use:
 * +++++++++++++++++++++++++++++++
 * <directed-graph [graph]="graph">
 *   <ng-template #node let-node>
 *     Custom node: {{ node.id }}
 *   </ng-template>
 * </directed-graph>
 *
 * Nodes
 * +++++++++++++++++++++++++++++++
 * - Nodes supplied to the graph must have a width and height set. This is
 *   required to perform the layout step.
 * - x/y coordinates do not need to be set - they will be set automatically
 *
 * Node Template (optional)
 * +++++++++++++++++++++++++++++++
 * The node template lets you customize how nodes are rendered in the graph.
 * It is supplied the Node as an implicit parameter. This template expects
 * to be rendered with html, which will be automatically positioned within the
 * svg for you using <svg:foriegnObject>. This template is identified using
 * any <ng-template> with #node attribute nested under the graph component.
 *
 * eg:
 * <ng-template #node let-node>
 *   {{ node.data.myCustomProperty }}
 * </ng-template>
 *
 * Edge Template (optional)
 * +++++++++++++++++++++++++++++++
 * The edge template lets you customize how edges are rendered in the graph.
 * It is supplied the Edge as an implicit parameter. Unlike the node template,
 * this template expects to be rendered using svg elements. The contents of this
 * template are also not positioned automatically for you like the node
 * templates are: you must draw the lines connecting the two nodes using
 * their absolute (relative to the svg) positions. You can use the edge points
 * property or the edge.src and edge.dest x/y values for those. This template is
 * identified using any <ng-template> with #edge attribute nested under the
 * graph component.
 *
 * eg:
 * <ng-template #edge let-edge>
 *   <svg:line [attr.x1]="edge.src.x" [attr.y1]="edge.src.y"
 *             [attr.x2]="edge.dest.x" [attr.y2]="edge.dest.x"></svg:line>
 * </ng-template>
 *
 * Node/Edge Selection
 * +++++++++++++++++++++++++++++++
 * {@code GraphSelectEvent} will also be emitted when a node or edge is clicked,
 * or selected with the keyboard.
 *
 * eg: <directed-graph [graph]="graph"
 * (select)="onSelect($event)"></directed-graph>
 *
 * Editable (optional)
 * +++++++++++++++++++++++++++++++
 * When the editable flag is set, the graph will expose UI for the user to
 * add/delete nodes and edges on the provided graph. Users may create new nodes
 * and edges by dragging the mouse outward from an existing node. If a drag ends
 * on another node, a new edge is created. If a drag ends on the canvas, a new
 * node and a joining edge to that node are created. Users may use the delete
 * and backspace keys to delete the currently focused/selected node or edge.
 *
 * Deleting a node will also delete incoming and outgoing edges from that node.
 * Deleting an edge will not delete any nodes along with it.
 *
 * Nodes and edges added to the graph are added to directed-graph's local copy.
 * Edits will emit one of the two following events: {@code GraphCreateEvent},
 * {@code GraphDeleteEvent}, providing a hook for users to update their copy of
 * graph data, as well a means to provide updated NodeData and EdgeData to the
 * graph component.
 *
 * eg:
 * <directed-graph
 *     [graph]="graph"
 *     [editable]="true"
 *     (create)="onCreate($event)"
 *     (delete)="onDelete($event)">
 * </directed-graph>
 *
 * Additionally, you may also provide dragNode and dragEdge templates to
 * customize the UI elements used for the drag interaction during node and edge
 * creation.The dragNode is rendered beneath the cursor, and the dragEdge is
 * rendered between the dragNode and the node from which the drag was initiated.
 * The dragNode template is provided with a node, and the dragEdge is provided
 * with an edge, following the same behavior as the standard node and edge
 * templates described above.
 */
@Component({
  preserveWhitespaces: true,
  selector: 'directed-graph',
  templateUrl: './graph.ng.html',
  styleUrls: ['./graph.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphComponent implements AfterViewInit, OnChanges, OnDestroy {
  /** The graph svg element. */
  @ViewChild('graphEl', {static: false}) graphEl?: ElementRef;

  /** An (optional) custom html template used to render nodes. */
  @ContentChild('node', {static: false}) nodeTemplate?: TemplateRef<{}>;

  /** An (optional) custom svg template used to render edges. */
  @ContentChild('edge', {static: false}) edgeTemplate?: TemplateRef<{}>;

  /**
   * An (optional) custom html template used to render a temporary node image
   * shown at the cursor when dragging to add new nodes and edges to the graph.
   */
  @ContentChild('dragNode', {static: false}) dragNodeTemplate?: TemplateRef<{}>;

  /**
   * An (optional) custom svg template used to render a temporary node edge
   * shown when dragging to add new nodes and edges to the graph.
   */
  @ContentChild('dragEdge', {static: false}) dragEdgeTemplate?: TemplateRef<{}>;

  /** Controls paning and zooming of the graph. */
  camera?: GraphCamera;

  /** The graph to render. */
  graph: Graph = emptyGraph();

  /** Dagre's representation of the graph. */
  graphLib?: graphlib.Graph;

  /** Options that control how nodes a laid out. */
  layout: LayoutOptions = DEFAULT_LAYOUT_OPTIONS;

  /** A subscription listening to mouse move events. */
  mousemoveSubscription?: Subscription;

  /** A subscription listening to mouse up events. */
  mouseupSubscription?: Subscription;

  /** True if the graph is still being setup/initialized. */
  loading = true;

  /** True if the user is currently dragging the cursor during edit mode. */
  dragging = false;

  /** True if the user is currently panning on the canvas. */
  panning = true;

  /**
   * True if a pan has occurred since the last mouse down event. This is used
   * for filtering out panning from canvas click events.
   */
  panOccurred = false;

  /** Cached SVGPoint used for cursor coordinate transformations. */
  svgCursorPoint?: SVGPoint;

  /** Node to display while dragging. */
  dragNode: Node = {
    id: '+',
    width: DEFAULT_NODE_SIZE,
    height: DEFAULT_NODE_SIZE,
  };

  /** Edge to display while dragging. */
  dragEdge: Edge = {
    src: this.dragNode,
    dest: this.dragNode,
    points: [],
  };

  /** Node from which the most recent drag started from. */
  dragSrcNode?: Node;

  /** The currently selected element. */
  selectedEl?: Node|Edge;

  /** The current element the mouse is over. */
  hoveredEl?: Node|Edge;

  /** An element used to highlight its predecessors and successors */
  highlightedEl?: Node|Edge;

  /** Nodes and edges that are parents of the highlighted item. */
  predecessors = new Set<Node|Edge>();

  /** Nodes and edges that are children the highlighted item. */
  successors = new Set<Node|Edge>();

  /**
   * The point (in svg space) where the selected item was click on with
   * the mouse. Undefined if the selected element was picked w/o the mouse.
   */
  selectedElMousePoint?: Point;

  /**
   * The ID of the currently focused element.
   *
   * Since we don't need to keep track of whether the item is a node or edge,
   * we only need to keep the ID around to track the focused item.
   */
  focusedElId?: string;

  /** Counter used for generating unique new node names. */
  maxNodeId = 0;

  /** Set used for keeping track of taken node ids. */
  nodeIds = new Set<string>();

  /** Aliases for template access. */
  curvedPath = curvedPath;
  getId = getId;

  /** Enables the graph to be edited */
  @Input() editable = false;

  /** Enables zoom in/out/reset controls */
  @Input() showZoomControls = false;

  @Input() enableMouseWheelZoom = true;

  @Input() cameraResetBehaviorOnGraphSet = CameraResetBehaviorEnum.NONE;

  @Input() cameraSmoothResetDurationMs = 500;

  @Input() enableNodeEdgeAnimation = false;

  /** Supplied graph to render. */
  @Input('graph')
  set onGraphSet(graph: Graph|undefined) {
    this.graph = graph ? shallowCopy(graph) : emptyGraph();
    this.updateGraphLayout();
    this.updatePriorSelectionsAfterGraphMutation();
    this.updateHighlightedRelatives();
    this.updateNodeIds();

    // Camera reset needs to happen outside of the Angular component rendering
    // lifecycle so that it waits for the graph to be painted on to the DOM
    // correctly before attempting to recenter.
    switch (this.cameraResetBehaviorOnGraphSet) {
      case CameraResetBehaviorEnum.RESET:
        setTimeout(() => {
          this.resetCamera();
        }, 0);
        break;
      case CameraResetBehaviorEnum.SMOOTH_RESET:
        setTimeout(() => {
          this.smoothResetCamera();
        }, 0);
        break;
      default:
    }
  }

  @Input('layout')
  set onLayoutSet(layout: LayoutOptions|undefined) {
    this.layout = {
      ...DEFAULT_LAYOUT_OPTIONS,
      ...layout || {},
    };
    this.updateGraphLayout();
    this.resetCamera();
  }

  /**
   * Emits when a graph object has been created.
   */
  @Output() create = new EventEmitter<GraphCreateEvent>();

  /**
   * Emits when a graph object has been deleted.
   */
  @Output() delete = new EventEmitter<GraphDeleteEvent>();

  /**
   * Emits when a graph object has been selected.
   */
  @Output() select = new EventEmitter<GraphSelectEvent>();

  constructor(
      private readonly changeDetectorRef: ChangeDetectorRef,
      private readonly windowRef: WindowRef,
      @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  ngAfterViewInit() {
    // Finish graph setup.
    // There is a timing issue here because we need to initially render the
    // graph before we know the dimensions for pan/zoom. To avoid flicker we:
    //
    // 1: Start the graph hidden using visibility:hidden
    // 2: Give Angular time to render the container with setTimeout so
    //    svg-pan-zoom has proper container dimensions to work with
    // 3: Switch visibility of the graph only after it is recentered
    setTimeout(() => {
      this.setupCamera();
      this.loading = false;
      this.changeDetectorRef.markForCheck();
    }, 0);

    if (this.graphEl) {
      this.svgCursorPoint = this.graphEl.nativeElement.createSVGPoint();
    }
  }

  ngOnChanges() {
    // Subscribe/Unsubscribe from edit related mouse events when the editable
    // flag is toggled

    if (this.editable && !this.mousemoveSubscription) {
      this.mousemoveSubscription =
          fromEvent<MouseEvent>(this.windowRef.native, 'mousemove')
              .subscribe((event) => {
                this.mouseMove(event);
              });
    } else if (!this.editable && this.mousemoveSubscription) {
      this.mousemoveSubscription.unsubscribe();
      this.mousemoveSubscription = undefined;
    }

    if (this.editable && !this.mouseupSubscription) {
      this.mouseupSubscription =
          fromEvent<MouseEvent>(this.windowRef.native, 'mouseup')
              .subscribe((event) => {
                this.windowMouseUp(event);
              });
    } else if (!this.editable && this.mouseupSubscription) {
      this.mouseupSubscription.unsubscribe();
      this.mouseupSubscription = undefined;
    }
  }

  ngOnDestroy() {
    if (this.mousemoveSubscription) {
      this.mousemoveSubscription.unsubscribe();
    }

    if (this.mouseupSubscription) {
      this.mouseupSubscription.unsubscribe();
    }

    if (this.camera) {
      this.camera.destroy();
    }
  }

  /**
   * Sets the selected node by id. Use undefined to clear any existing
   * selected node.
   *
   * Accepts an optional parameter with settings:
   *
   * - emitEvent: Sets whether a selection event should be emitted
   *       as a result of this selection. Defaults to false.
   */
  selectNodeById(id: string|undefined, options: {emitEvent?: boolean} = {}) {
    // If the current selection is an edge and no node id was set,
    // don't lose current selection.
    if (!id && this.selectedEl && isEdge(this.selectedEl)) {
      return;
    }

    const node = this.getNodeById(id);
    this.setSelected(node, options);
  }

  /**
   * Sets the selected node or edge.
   * Use 'undefined' to clear any existing selection.
   * Accepts an optional parameter with settings:
   *
   * - emitEvent: Sets whether a selection event should be emitted
   *       as a result of this selection. Defaults to false.
   * - focus: Pushes keyboard focus to the selected element. Defaults to false.
   * - mousePoint: Sets an optional point in SVG space associated with a
   *       where the user clicked to select the item. If unset (or el is unset),
   *       clears any prior cached mouse point.
   */
  private setSelected(el?: Node|Edge, options: {
    emitEvent?: boolean,
    focus?: boolean,
    mousePoint?: Point,
  } = {}) {
    if (!!el) {
      this.selectedEl = el;
      this.selectedElMousePoint = options.mousePoint;
      if (options.focus) this.setFocus(el);
    } else {
      this.selectedEl = undefined;
      this.selectedElMousePoint = undefined;
    }

    this.updateHighlightedRelatives();

    if (options.emitEvent) {
      if (!this.selectedEl) {
        this.select.emit({});
      } else if (isNode(this.selectedEl)) {
        this.select.emit({node: this.selectedEl});
      } else {
        this.select.emit({edge: this.selectedEl});
      }
    }

    this.changeDetectorRef.markForCheck();
  }

  /**
   * Sets what element is currently being hovered over with the mouse. Set
   * to undefine to signal that nothing is being hovered.
   */
  setHovered(el?: Node|Edge) {
    this.hoveredEl = el;
    this.updateHighlightedRelatives();
  }

  /**
   * Determines whether something should be highlighted because it is selected
   * or hovered and updates the successor and predecessor sets.
   */
  private updateHighlightedRelatives() {
    const lib = this.graphLib!;
    this.highlightedEl = this.selectedEl || this.hoveredEl || undefined;

    if (!this.highlightedEl) {
      this.predecessors = new Set();
      this.successors = new Set();
    } else if (isNode(this.highlightedEl)) {
      const nodeId = this.highlightedEl.id;
      this.predecessors = getPredecessors(nodeId, lib);
      this.successors = getSuccessors(nodeId, lib);
    } else {
      this.predecessors = new Set([this.highlightedEl.src]);
      this.successors = new Set([this.highlightedEl.dest]);
    }
  }

  /**
   * Returns a node for a given id or undefined if not found.
   */
  getNodeById(id: string|undefined): Node|undefined {
    return this.graph.nodes.find(n => n.id === id);
  }

  /**
   * Returns the lowest available node id of the format `n{number}`.
   * Public in case users of the graph wish to manually create new nodes.
   */
  getNewNodeId() {
    while (this.nodeIds.has(`n${this.maxNodeId}`)) {
      this.maxNodeId++;
    }
    const newId = `n${this.maxNodeId}`;
    this.nodeIds.add(newId);
    return newId;
  }

  /**
   * Updates the node ids lookup table used for generating new node ids.
   */
  private updateNodeIds() {
    this.nodeIds = new Set<string>();
    for (const node of this.graph.nodes) {
      this.nodeIds.add(node.id);
    }
    this.maxNodeId = 0;
  }

  // DAGRE HELPER FUNCTIONS

  /**
   * Re-lays out the graph when it is updated.
   */
  private updateGraphLayout() {
    const g = new graphlib.Graph();
    this.graphLib = g;

    g.setGraph(convertToDagreOptions(this.layout));

    for (const node of this.graph.nodes) {
      g.setNode(node.id, node);
    }

    for (const edge of this.graph.edges) {
      g.setEdge(edge.src.id, edge.dest.id, edge);
    }

    layout(g);
  }

  // CAMERA FUNCTIONS

  /**
   * Checks whether the graph element has been created.
   */
  private existGraphElement(): boolean {
    if (!this.graphEl || !this.graphEl.nativeElement ||
        this.graphEl.nativeElement.getBoundingClientRect().width === 0) {
      return false;
    }
    return true;
  }

  /**
   * Initializes the graph camera.
   */
  setupCamera() {
    if (this.camera || !this.graphEl || !this.existGraphElement()) {
      return;
    }

    this.camera = new GraphCamera({
      svgEl: this.graphEl.nativeElement,
      windowRef: this.windowRef,
      autoResetOnWindowResize: true,
      mouseWheelZoomEnabled: this.enableMouseWheelZoom,
    });

    this.camera.onPan.subscribe(() => {
      this.panOccurred = true;
    });
  }

  /**
   * Re-centers and fits the graph to the available canvas.
   */
  resetCamera() {
    if (this.camera) {
      this.camera.reset();
    }
  }

  smoothResetCamera() {
    if (this.camera) {
      this.camera.smoothReset(this.cameraSmoothResetDurationMs);
    }
  }

  /**
   * Zooms the camera in by one step.
   */
  zoomIn() {
    if (this.camera) {
      this.camera.zoomIn();
    }
  }

  /**
   * Zooms the camera out by one step.
   */
  zoomOut() {
    if (this.camera) {
      this.camera.zoomOut();
    }
  }

  /**
   * Pans the camera so a node with the given id is in view.
   */
  panNodeIntoView(id: string) {
    const node = this.graph.nodes.find(n => n.id === id);
    if (this.camera && node) {
      this.camera.panNodeIntoView(node);
    }
  }

  /**
   * Converts the coordinates from a mouse event into the svg graph space.
   *
   * Visible for testing.
   */
  domToWorldSpace($event: MouseEvent): Point|undefined {
    return this.camera && this.camera.domToWorldSpace({
      x: $event.clientX,
      y: $event.clientY,
    });
  }

  // MOUSE/KEYBOARD EVENT HANDLERS

  @HostListener('keyup', ['$event'])
  keyEvent(event: KeyboardEvent) {
    if (!!this.editable) {
      // Handle deletes on the selected element when the keyboard focus is
      // elsewhere
      if (isDeleteEvent(event) && !!this.selectedEl) {
        this.deleteNodeOrEdge(this.selectedEl);
      }
    }

    // Handle element deselection
    if (isEscapeEvent(event)) {
      this.deselect();
    }
  }

  /** Starts a graph edit when dragging a node */
  nodeMouseDown($event: MouseEvent, node: Node) {
    if (this.editable) {
      this.startDrag(node);
    }

    // Prevents the default drag and drop behavior of highlighting text
    // content on the svg canvas
    $event.preventDefault();

    // Prevents SvgPanZoom from panning when mousing down on a node, as well as
    // preventing the canvas click handler from triggering

    $event.stopPropagation();
  }

  /** Adds edge creation when dragging onto a node. */
  nodeMouseUp($event: MouseEvent, node: Node) {
    if (this.editable) {
      this.endDrag();
      if (this.dragSrcNode && this.dragSrcNode !== node) {
        this.addEdge(this.dragSrcNode, node);
      }

      // Prevents the canvas click handler from triggering
      $event.stopPropagation();
    }
  }

  /** Handles node creation when dragging onto the canvas. */
  canvasMouseUp($event: MouseEvent) {
    this.panning = false;
    if (this.dragging) {
      this.endDrag();
      const svgPoint = this.domToWorldSpace($event);

      const dest: Node = {
        id: this.getNewNodeId(),
        width: DEFAULT_NODE_SIZE,
        height: DEFAULT_NODE_SIZE,
        x: svgPoint && svgPoint.x || 0,
        y: svgPoint && svgPoint.y || 0,
      };

      if (this.dragSrcNode) {
        this.deselect();
        this.addNode(this.dragSrcNode, dest);
      }
    }
    this.changeDetectorRef.markForCheck();
  }

  canvasMouseDown() {
    // Clear the panOccurred state to begin detection of whether a click is
    // a pan or a plain canvas click
    this.panOccurred = false;
    this.panning = true;
    this.changeDetectorRef.markForCheck();
  }

  canvasClick($event: MouseEvent) {
    if (!this.panOccurred) {
      // If we detected a mouseup on the canvas (while we were not adding a
      // node or edge), and a pan did not occur on the canvas while the mouse
      // was down, we consider this a canvas click.
      this.deselect();
    }
  }

  /** Handles the movement of the drag node. */
  mouseMove($event: MouseEvent) {
    if (this.dragging) {
      // Transform the location of the drag node along with the mouse
      const svgPoint = this.domToWorldSpace($event);
      this.dragNode.x = svgPoint && svgPoint.x || 0;
      this.dragNode.y = svgPoint && svgPoint.y || 0;

      // Manually mark for update, since mouse moves are handled as
      // observables here to avoid extraneous event listeners when in edit
      // mode.
      this.changeDetectorRef.markForCheck();
    }
  }

  windowMouseUp($event: MouseEvent) {
    // If a drag event starts on the canvas and ends up outside of the canvas,
    // stop the drag
    if (this.dragging) {
      this.endDrag();
      this.changeDetectorRef.markForCheck();
    }
  }

  /**
   * Handles delete and selection events on a node or edge via key press.
   */
  onNodeEdgeKeyPress(el: Node|Edge, event: KeyboardEvent) {
    if (this.editable && isDeleteEvent(event)) {
      // Delete node/edge, triggered by delete keypress
      this.deleteNodeOrEdge(el);
      return false;
    } else {
      this.setSelected(el, {emitEvent: true, focus: true});
    }
    return true;
  }

  /**
   * Handles selection events on a node or edge via click.
   */
  onNodeEdgeClick(el: Node|Edge, $event: MouseEvent) {
    const svgPoint = this.domToWorldSpace($event);
    const mousePoint = svgPoint ? {x: svgPoint.x, y: svgPoint.y} : undefined;
    this.setSelected(el, {emitEvent: true, focus: true, mousePoint});
    $event.stopPropagation();
    return true;
  }

  // FUNCTIONS FOR UPDATING GRAPH TOPOLOGY

  /** Adds a new edge to the graph. */
  private addEdge(src: Node, dest: Node) {
    const edge = {src, dest, points: []};
    this.graph.edges.push(edge);
    this.changeDetectorRef.markForCheck();

    // Give the new elements a chance to update so that they can be tracked,
    // to give animations a reference point when the layout is updated or an
    // emit causes any downstream changes to the layout
    setTimeout(() => {
      this.setSelected(edge, {focus: true});
      this.updateGraphLayout();
      this.updateHighlightedRelatives();
      this.create.emit({edge});
    }, 0);
  }

  /** Adds a new node, and accompanying edge to the graph */
  private addNode(src: Node, dest: Node) {
    const edge = {src, dest, points: []};
    this.graph.nodes.push(dest);
    this.graph.edges.push(edge);
    this.changeDetectorRef.markForCheck();

    // Give the new elements a chance to update so that they can be tracked,
    // to give animations a reference point when the layout is updated or an
    // emit causes any downstream changes to the layout
    setTimeout(() => {
      this.setSelected(dest, {focus: true});
      this.updateGraphLayout();
      this.updateHighlightedRelatives();
      this.create.emit({node: dest, edge});
    }, 0);
  }

  /** Deletes a node or edge. */
  private deleteNodeOrEdge(el: Node|Edge) {
    let deleteEvent;
    if (isNode(el)) {
      // Reflect changes in the graph
      const i = this.graph.nodes.indexOf(el);
      if (i > -1) {
        this.graph.nodes.splice(i, 1);
      }

      // Remove incoming/outgoing edges
      this.graph.edges =
          this.graph.edges.filter(edge => edge.src !== el && edge.dest !== el);

      deleteEvent = {node: el};
    } else if (isEdge(el)) {
      // Reflect changes in the graph
      const i = this.graph.edges.indexOf(el);
      if (i > -1) {
        this.graph.edges.splice(i, 1);
      }
      deleteEvent = {edge: el};
    }

    this.updateGraphLayout();
    this.updatePriorSelectionsAfterGraphMutation();
    this.updateHighlightedRelatives();
    this.delete.emit(deleteEvent);
  }

  /**
   * Examines the existing selection state (hover + selected) and verifies that
   * it is still valid given the current graph object. If the current selection
   * is invalid (eg refers to a node that doesn't exist any more), it will be
   * cleared.
   *
   * Existing selections are searched for using their ids. This means that if
   * a new graph object was set that used the same ids, selection will still be
   * persisted.
   */
  private updatePriorSelectionsAfterGraphMutation() {
    const everything = [...this.graph.nodes, ...this.graph.edges];

    if (this.selectedEl) {
      const oldId = getId(this.selectedEl);
      const found = everything.find(el => getId(el) === oldId);
      if (found !== this.selectedEl) {
        this.setSelected(found, {emitEvent: false});
      }
    }

    if (this.hoveredEl) {
      const oldId = getId(this.hoveredEl);
      const found = everything.find(el => getId(el) === oldId);
      if (found !== this.hoveredEl) {
        this.setHovered(found);
      }
    }
  }

  /** Clears the selected element state, emitting the selection event. */
  private deselect() {
    this.setSelected(undefined, {emitEvent: true});
  }

  /**
   * Sets the focus to the provided element.
   */
  private setFocus(el: Node|Edge): void {
    if (this.editable) {
      const found = this.document.querySelector<HTMLElement>(`g#${getId(el)}`)!;
      if (!!found) {
        found.focus();
      }
    }
  }

  /**
   * Returns whether the provided element is selected.
   */
  isSelected(el: Node|Edge): boolean {
    return !!this.selectedEl && (getId(this.selectedEl) === getId(el));
  }

  /**
   * Returns true if the graph is currently highlighting relatives.
   */
  isHighlighting() {
    return !!this.highlightedEl;
  }

  /**
   * Returns true if the element is having its relatives highlighted.
   */
  isHighlighted(el: Node|Edge) {
    return el === this.highlightedEl;
  }

  /**
   * Returns true if the element is a predecessor to the currently highlighted
   * element.
   */
  isPredecessor(el: Node|Edge): boolean {
    return this.predecessors.has(el);
  }

  /**
   * Returns true if the element is a successor to the currently highlighted
   * element.
   */
  isSuccessor(el: Node|Edge): boolean {
    return this.successors.has(el);
  }

  /**
   * Returns a point (in svg space) where the selected item was selected by the
   * mouse. Returns undefined if the passed element is not current selected
   * or if the selected element was selected by means other than the mouse.
   */
  getSelectedMousePoint(el: Node|Edge): Point|undefined {
    return this.isSelected(el) ? this.selectedElMousePoint : undefined;
  }

  /**
   * Returns whether the provided element is focused.
   */
  isFocused(el: Node|Edge): boolean {
    return this.focusedElId === this.getId(el);
  }

  /** Updates the focus state with the provided edge/node. */
  onFocus(el: Node|Edge) {
    this.focusedElId = getId(el);
    this.changeDetectorRef.markForCheck();
  }

  /** Clears the focus state on blur. */
  onBlur() {
    this.focusedElId = undefined;
    this.changeDetectorRef.markForCheck();
  }

  /* Sets up state at the start of a drag. */
  private startDrag(node: Node) {
    this.dragSrcNode = node;
    this.dragNode.x = node.x;
    this.dragNode.y = node.y;
    this.dragEdge.src = node;
    this.dragging = true;
  }

  /** Updates state at the end of a drag. */
  private endDrag() {
    this.dragging = false;
    this.dragEdge.src = this.dragNode;
    this.dragEdge.dest = this.dragNode;
  }

  /**
   * Provides an id to uniquely track a node or edge across graph updates.
   */
  trackByFn(index: number, el: Node|Edge): string {
    return getId(el);
  }
}

/**
 * Returns an empty graph.
 */
function emptyGraph(): Graph {
  return {nodes: [], edges: []};
}

/**
 * Converts the graph layout options interface to the structure used by dagre.
 */
function convertToDagreOptions(layout: LayoutOptions): GraphLabel {
  const alignment = layout.rankAlignment === RankAlignment.NONE ?
      undefined :
      layout.rankAlignment;

  return {
    rankdir: layout.rankDirection,
    align: alignment,
    ranksep: layout.rankSeparation,
    nodesep: layout.nodeSeparation,
    edgesep: layout.edgeSeparation,
    ranker: layout.ranker,
    marginx: 0,
    marginy: 0,
  };
}

/**
 * Given a node ID returns a set of immediate Nodes and Edges that are
 * predecessors/ancestors of it in the graph.
 */
function getPredecessors(nodeId: string, graphLib: graphlib.Graph) {
  const seen = new Set<Node|Edge>();

  // dagre predecessors typings are incorrect. It returns strings:
  const rawRelativeIds = graphLib.predecessors(nodeId) || [] as unknown;
  const relativeIds = rawRelativeIds as string[];

  const nodes = relativeIds.map(rid => graphLib.node(rid) as Node);
  const edges = relativeIds.map(rid => graphLib.edge(rid, nodeId) as Edge);

  nodes.forEach(n => {
    seen.add(n);
  });
  edges.forEach(e => {
    seen.add(e);
  });

  return seen;
}

/**
 * Given a node ID returns a set of immediate Nodes and Edges that are
 * successors/children of it in the graph.
 */
function getSuccessors(nodeId: string, graphLib: graphlib.Graph) {
  const seen = new Set<Node|Edge>();

  // dagre successors typings are incorrect. It returns strings:
  const rawRelativeIds = graphLib.successors(nodeId) || [] as unknown;
  const relativeIds = rawRelativeIds as string[];

  const nodes = relativeIds.map(rid => graphLib.node(rid) as Node);
  const edges = relativeIds.map(rid => graphLib.edge(nodeId, rid) as Edge);

  nodes.forEach(n => {
    seen.add(n);
  });
  edges.forEach(e => {
    seen.add(e);
  });

  return seen;
}

/**
 * Creates a shallow copy of the provided graph, two levels deep.
 */
function shallowCopy(g: Graph): Graph {
  return {
    nodes: [...g.nodes],
    edges: [...g.edges],
  };
}

/**
 * Typeguard for a Node.
 */
function isNode(el: Node|Edge): el is Node {
  const cast = el as Node;
  return !!cast.id;
}

/**
 * Typeguard for an edge.
 */
function isEdge(el: Node|Edge): el is Edge {
  const cast = el as Edge;
  return !!cast.src && !!cast.dest;
}

/**
 * Returns a unique id for node or edge in the graph.
 */
function getId(el: Node|Edge): string {
  if (isNode(el)) {
    return `n-${el.id}`;
  } else {
    return `e-${el.src.id}-${el.dest.id}`;
  }
}

/**
 * Returns true iff the provided keyboard event signals a graph delete.
 */
function isDeleteEvent(event?: KeyboardEvent): boolean {
  return !!event && (DELETE_DOM_STRINGS.indexOf(event.key) !== -1);
}

/**
 * Returns true iff the provided keyboard event is an escape event.
 */
function isEscapeEvent(event?: KeyboardEvent): boolean {
  return !!event && (event.key === 'Escape');
}
