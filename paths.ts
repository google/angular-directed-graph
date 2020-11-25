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

import {Edge, LayoutOptions, Node, Point, RankDirection} from './model';

/**
 * @fileOverview Utility methods to generate svg path strings.
 */

/**
 * When using layout direction smoothing, this is the length in pixels that
 * the bezier control points should be offset from their points. Higher numbers
 * make the path more curved while lower values make it close to a regular line.
 */
const LAYOUT_CURVE_FORCE_PX = 20;

/**
 * When using generic path smoothing, this is the length in pixels that the
 * the bezier control points should be offset from their points.
 */
const SMOOTH_CURVE_FORCE_PX = 2;

/**
 * "Unimportant points" are detected based on the distance they would be from
 * a hypothetical path created as if they never existed. Points with distances
 * under this threshold are given less visual signifiance so as to not distort
 * the path.
 */
const UNIMPORTANT_POINT_DISTANCE_THRESHOLD_PX = 20;

/**
 * Converts a set of points to a series of lines connecting them.
 */
export function pointsToLines(points?: Point[]): string {
  if (!points || points.length < 2) {
    return '';
  }

  const coords = points.map(p => `${p.x},${p.y}`);
  const joinedCoords = coords.join(' ');
  return `M ${joinedCoords}`;
}

/**
 * Converts an edge to a SVG path connecting it from src to dest.
 */
export function curvedPath(
    edge: Edge,
    layout: LayoutOptions = {
      rankDirection: RankDirection.LEFT_TO_RIGHT
    },
    ): string {
  // These are the points that dagre has suggested to connect the nodes.
  // Example: https://github.com/google/angular-directed-graph/images/D90JKX5BsOQ.png
  const points = edge.points;

  // If no points are suggested, default to the src and dest nodes.
  if (points.length === 0) points.length = 2;

  // Dagre puts the first and last points at arbitrary points along the border
  // of the nodes. We don't want this. Instead, we want the first and last
  // points for all edges exiting/entering nodes to be at certain connection
  // points. Example: https://github.com/google/angular-directed-graph/images/UCxBAz9YhWn.png
  const srcConnectors = getConnectorPointsForNode(edge.src, layout);
  const destConnectors = getConnectorPointsForNode(edge.dest, layout);
  points[0] = srcConnectors.output;
  points[points.length - 1] = destConnectors.input;

  // Generate metadata about every point in the path, then convert this to
  // an svg path.
  const data = createPointData(points, layout);
  const path = createPathFromPointData(data);

  return path;
}

/** Creates a triangle for the pointing tip of an {@link Edge}. */
export function trianglePoints(edge: Edge, layout: LayoutOptions) {
  const triangleSideLength = 10;
  const triangleHeightRatio = 0.86602540378;

  if (!edge.dest.x || !edge.dest.y) {
    throw new RangeError('Edge point should not be a nullish value.');
  }
  const center: Point = {x: edge.dest.x, y: edge.dest.y};
  const connector: Point = {...center};

  let trianglePoints: Point[] = [];

  switch (layout.rankDirection) {
    case RankDirection.LEFT_TO_RIGHT:
      connector.x -= edge.dest.width / 2;
      trianglePoints = [
        {...connector}, {
          x: connector.x - triangleSideLength * triangleHeightRatio,
          y: connector.y - triangleSideLength / 2
        },
        {
          x: connector.x - triangleSideLength * triangleHeightRatio,
          y: connector.y + triangleSideLength / 2
        }
      ];
      break;
    case RankDirection.RIGHT_TO_LEFT:
      connector.x += edge.dest.width / 2;
      trianglePoints = [
        {...connector}, {
          x: connector.x + triangleSideLength * triangleHeightRatio,
          y: connector.y - triangleSideLength / 2
        },
        {
          x: connector.x + triangleSideLength * triangleHeightRatio,
          y: connector.y + triangleSideLength / 2
        }
      ];
      break;
    case RankDirection.TOP_TO_BOTTOM:
      connector.y -= edge.dest.height / 2;
      trianglePoints = [
        {...connector}, {
          x: connector.x - triangleSideLength / 2,
          y: connector.y - triangleSideLength * triangleHeightRatio
        },
        {
          x: connector.x + triangleSideLength / 2,
          y: connector.y - triangleSideLength * triangleHeightRatio
        }
      ];
      break;
    case RankDirection.BOTTOM_TO_TOP:
    default:
      connector.y += edge.dest.height / 2;
      trianglePoints = [
        {...connector}, {
          x: connector.x - triangleSideLength / 2,
          y: connector.y + triangleSideLength * triangleHeightRatio
        },
        {
          x: connector.x + triangleSideLength / 2,
          y: connector.y + triangleSideLength * triangleHeightRatio
        }
      ];
      break;
  }

  return trianglePoints.map(point => `${point.x},${point.y}`).join(' ');
}

/**
 * Calculates where the bezier control points should be for every point in the
 * path. See:
 * https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Paths#Bezier_Curves
 */
function createPointData(
    points: Point[],
    layout: LayoutOptions,
    ): PathPointData[] {
  const pointsData: PathPointData[] = [];

  // In general, we try to generate bézier control points that cause the
  // path to curve in the direction of the "flow" of the layout (eg, top to
  // bottom). However, in some edge cases this will look awkward and we opt
  // out into a more generic smoothing technique that is more versitile, but
  // doesn't look as nice on average.

  const goesBackwards = doesPathGoBackwards(points, layout);

  for (let i = 0; i < points.length; i++) {
    if (goesBackwards) {
      pointsData.push(getSmoothedControlPoints(points, i));
    } else if (isPointUnimportant(points, i)) {
      pointsData.push(getSmoothedControlPoints(points, i));
    } else {
      pointsData.push(getLayoutCurvedControlPoints(points[i], layout));
    }
  }

  return pointsData;
}

/**
 * Generates bézier control points by having the control points aligned with the
 * direction of the flow of the layout. This results in edges that leave nodes
 * starting in the direction of layout flow, curving towards the next point,
 * then returning to the layout flow.
 *
 * For example, in a TOP_TO_BOTTOM layout, the control points connecting X to
 * Y would be where the Cs are.
 *
 *       +-----+
 *       |     |
 *  |    +--X--+
 *  |       |
 *  V       C\-----------\C
 *                        |
 *                     +--Y--+
 *                     |     |
 *                     +-----+
 */
function getLayoutCurvedControlPoints(
    point: Point,
    layout: LayoutOptions,
    ): PathPointData {
  const layoutForce = getLayoutVector(layout);

  layoutForce.multiplyScalar(LAYOUT_CURVE_FORCE_PX);
  const outgoingControlPoint = createNewPointOffsetBy(point, layoutForce);

  layoutForce.invert();
  const incomingControlPoint = createNewPointOffsetBy(point, layoutForce);

  return {point, incomingControlPoint, outgoingControlPoint};
}

/**
 * Generates bézier control points by having the control points aligned
 * parallel with a hypothetical line between the points before and
 * after this point in the path. This results in a smoothing effect in the path,
 * but can sometimes create paths that curve too much.
 *
 * For example, in the path between X, Y, and Z: Y's control points would be
 * placed where the C's are, as this path is parallel to X and Z.
 *
 *      +-----+
 *      |     |
 *      +--X--+
 *         |
 *       C |
 *         Y-------Z
 *           C
 */
function getSmoothedControlPoints(
    points: Point[],
    i: number,
    ): PathPointData {
  const point = points[i];
  const next = points[i + 1] || point;
  const prior = points[i - 1] || point;
  const smoothForce = createVectorBetweenPoints(prior, next);

  smoothForce.normalize();
  smoothForce.multiplyScalar(SMOOTH_CURVE_FORCE_PX);
  smoothForce.round(2);

  const outgoingControlPoint = createNewPointOffsetBy(point, smoothForce);

  smoothForce.invert();
  const incomingControlPoint = createNewPointOffsetBy(point, smoothForce);

  return {point, incomingControlPoint, outgoingControlPoint};
}

/**
 * Returns true if the point at the given path index is relatively unimportant
 * in terms of defining the overall path.
 *
 * More strictly, a point is unimportant if it falls within a small distance
 * of where the path would be anyways if the point were to never have existed.
 *
 * Diagram: https://github.com/google/angular-directed-graph/images/AfpgfDwNkck.png
 */
function isPointUnimportant(points: Point[], i: number) {
  const point = points[i];
  const next = points[i + 1];
  const prior = points[i - 1];

  // First and last points in a path are always important.
  if (!next || !prior) {
    return false;
  }

  // Unimportant points are close to the line that exists were they to have
  // never existed.
  const distance = getDistanceFromLine(prior, next, point);
  return distance <= UNIMPORTANT_POINT_DISTANCE_THRESHOLD_PX;
}

/**
 * Returns true if any line segement within the path goes againts the regular
 * flow of the layout.
 */
function doesPathGoBackwards(
    points: Point[],
    layout: LayoutOptions,
) {
  const layoutDirection = getLayoutVector(layout);
  for (let i = 0; i < points.length - 1; i++) {
    const point1 = points[i];
    const point2 = points[i + 1];

    if (isLineGoingBackwards(point1, point2, layoutDirection)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if a given line is going backwards against the flow of
 * the regular layout direction.
 */
function isLineGoingBackwards(
    p1: Point,
    p2: Point,
    layoutDirection: Vector,
) {
  // To determine this, we first multiply the distance vector between the two
  // points by the unit vector of the layout to zero out distance in the axis
  // we don't care about. We then look to see if any of the distance in the
  // remaining axis is negative as a sign that the distance went opposite what
  // was expected.

  // eg:
  // Direction flows positive and delta positive = Going forwards
  // Direction flows negative and delta negative = Going forwards
  // Direction flows negative and delta positive = Going backwards
  // Direction flows positive and delta negative = Going backwards

  const delta = createVectorBetweenPoints(p1, p2);
  delta.x *= layoutDirection.x;
  delta.y *= layoutDirection.y;

  return delta.x < 0 || delta.y < 0;
}

/**
 * Returns a normalized vector that points in the direction that the graph
 * layout should be flowing in. For example, a "LEFT_TO_RIGHT" layout would
 * have a vector of <1, 0> (pointing to the right)
 */
function getLayoutVector(layout: LayoutOptions) {
  switch (layout.rankDirection) {
    case RankDirection.LEFT_TO_RIGHT:
      return new Vector(1, 0);
    case RankDirection.RIGHT_TO_LEFT:
      return new Vector(-1, 0);
    case RankDirection.BOTTOM_TO_TOP:
      return new Vector(0, -1);
    case RankDirection.TOP_TO_BOTTOM:
    default:
      return new Vector(0, 1);
  }
}

/**
 * Given a node, returns the points on it where edges are allowed to be
 * connected.
 */
function getConnectorPointsForNode(node: Node, layout: LayoutOptions) {
  // Connector points are center aligned in the node and offset to the edge
  // along the direction of the layout flow.
  const center: Point = {x: node.x!, y: node.y!};
  const input = {...center};
  const output = {...center};

  // Move input/output to edge of node based on layout direction
  switch (layout.rankDirection) {
    case RankDirection.LEFT_TO_RIGHT:
      input.x -= node.width / 2;
      output.x += node.width / 2;
      break;
    case RankDirection.RIGHT_TO_LEFT:
      input.x += node.width / 2;
      output.x -= node.width / 2;
      break;
    case RankDirection.BOTTOM_TO_TOP:
      input.y += node.height / 2;
      output.y -= node.height / 2;
      break;
    case RankDirection.TOP_TO_BOTTOM:
    default:
      input.y -= node.height / 2;
      output.y += node.height / 2;
      break;
  }

  return {input, output};
}

// SVG PATH STRING GENERATION
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++

/**
 * Converts point metadata to a SVG path string.
 */
function createPathFromPointData(points: PathPointData[]): string {
  const segments: string[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const src = points[i];
    const dest = points[i + 1];
    const cp1 = src.outgoingControlPoint;
    const cp2 = dest.incomingControlPoint;

    if (i === 0) {
      segments.push(moveTo(src.point));
    }

    segments.push(cubicBezierTo(dest.point, cp1, cp2));
  }

  return segments.join(' ');
}

/**
 * Returns an SVG path string that moves the path cursor to the given point.
 */
function moveTo(p: Point) {
  return `M ${p.x},${p.y}`;
}

/**
 * Returns a SVG cubic bezier path string that connects from the current path
 * point to a new point.
 */
function cubicBezierTo(
    dest: Point,
    controlPoint1: Point,
    controlPoint2: Point,
) {
  return `C ${controlPoint1.x},${controlPoint1.y} ` +
      `${controlPoint2.x},${controlPoint2.y} ` +
      `${dest.x},${dest.y}`;
}

// GEOMETRIC UTILITY METHODS
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++

/**
 * Given the start and end points that define a line and another arbitrary
 * point, returns the shortest distance between the point and the line.
 */
export function getDistanceFromLine(
    lineStart: Point,
    lineEnd: Point,
    point: Point,
) {
  // We determine the distance by scalar projecting the vector from
  // start --> point onto a unit vector perpedicular to the supplied line.
  // This gives us the component of the vector that is perpendicular to the
  // line (aka, the shortest distance).
  //
  // Diagram: https://github.com/google/angular-directed-graph/images/WdB9hJ4n9MQ.png
  // Scalar projection: https://en.wikipedia.org/wiki/Scalar_projection
  const line = createVectorBetweenPoints(lineStart, lineEnd);
  line.normalize();

  const perpendicularLine = createPerpendicularVector(line);
  const toProject = createVectorBetweenPoints(lineStart, point);
  const distance = toProject.dot(perpendicularLine);

  // Absolute because it doesn't matter if the point is above or below the line.
  return Math.abs(distance);
}

/**
 * Creates a new vector that covers the distance between p1 and p2.
 */
function createVectorBetweenPoints(p1: Point, p2: Point) {
  return new Vector(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Creates a new point that is offset from the existing point by the force
 * in the vector.
 */
function createNewPointOffsetBy(p1: Point, v: Vector): Point {
  return {
    x: p1.x + v.x,
    y: p1.y + v.y,
  };
}

/**
 * Given a vector, returns a new vector that is perpendiculat to the source
 * vector by rotating it 90 degrees counter-clockwise.
 */
function createPerpendicularVector(v: Vector) {
  return new Vector(-v.y, v.x);
}

// INTERFACES / SUPPORT CLASSES
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++

/**
 * Metadata about a point in the path.
 */
interface PathPointData {
  /** The x,y coordinates */
  point: Point;

  /** A bezier control point to be used in a segment ending at this point */
  incomingControlPoint: Point;

  /** A bezier control point to be used in a segment starting at this point */
  outgoingControlPoint: Point;
}

/**
 * A basic 2d vector class to help with path calculations. Mutable.
 */
class Vector {
  constructor(
      public x = 0,
      public y = 0,
  ) {}

  /**
   * Inverts the vector to point in the opposite direction.
   */
  invert() {
    this.x *= -1;
    this.y *= -1;
  }

  /**
   * Scales the vector by the specified amount.
   */
  multiplyScalar(amount: number) {
    this.x *= amount;
    this.y *= amount;
  }

  /**
   * Returns the scalar dot product between this and another vector.
   */
  dot(other: Vector): number {
    return this.x * other.x + this.y * other.y;
  }

  /**
   * Makes this vector a unit-vector by scaling it such its length is 1.
   */
  normalize() {
    const length = this.length();
    const multiplyBy = length === 0 ? 0 : 1 / length;
    this.multiplyScalar(multiplyBy);
  }

  /**
   * Returns the length of the vector.
   */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Rounds the x/y values of the vector to the number of decimal points.
   */
  round(numDecialPoints = 0) {
    const scaleBy = Math.pow(10, numDecialPoints);
    this.x = Math.round(this.x * scaleBy) / scaleBy;
    this.y = Math.round(this.y * scaleBy) / scaleBy;
  }

  /**
   * Creates a new vector with the same values.
   */
  copy() {
    return new Vector(this.x, this.y);
  }
}
