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

/**
 * @fileoverview Models used by the graph component.
 */

/**
 * Represents a graph composed of nodes and edges.
 */
export interface Graph<NodeData = unknown, EdgeData = unknown> {
  nodes: Array<Node<NodeData>>;
  edges: Array<Edge<NodeData, EdgeData>>;
  groups?: Array<Node<NodeData>>;
}

/**
 * Describes a single node in the graph.
 */
export interface Node<NodeData = unknown> {
  /** A unique id for the node within the graph. */
  id: string;

  /** x position in the svg. (Set by graph. Initial values ignored.) */
  x?: number;

  /** y position in the svg.  (Set by graph. Initial values ignored.) */
  y?: number;

  /** The width of the node (used for layout calculations) */
  width: number;

  /** The height of the node (used for layout calculations) */
  height: number;

  /** The list of children node id. */
  children?: string[];

  /** Custom data to associate with this node. */
  data?: NodeData;
}

/**
 * Describes a connection between two nodes in the graph.
 */
export interface Edge<NodeData = unknown, EdgeData = unknown> {
  /** The source node. */
  src: Node<NodeData>;

  /** The destination node. */
  dest: Node<NodeData>;

  /** The points describing the path of the edge. */
  points: Point[];

  /** Custom data to associate with this node. */
  data?: EdgeData;
}

/**
 * An event emitted whenever a single create occurs to the graph.
 */
export interface GraphCreateEvent<NodeData = unknown, EdgeData = unknown> {
  /** The new node */
  node?: Node<NodeData>;

  /** The new edge */
  edge?: Edge<NodeData, EdgeData>;
}

/**
 * An event emitted whenever a single deletion occurs to the graph.
 */
export interface GraphDeleteEvent<NodeData = unknown, EdgeData = unknown> {
  /** The deleted node */
  node?: Node<NodeData>;

  /** The deleted edge */
  edge?: Edge<NodeData, EdgeData>;
}

/**
 * An event emitted whenever an element is selected from the graph.
 */
export interface GraphSelectEvent<NodeData = unknown, EdgeData = unknown> {
  /** The selected node */
  node?: Node<NodeData>;

  /** The selected edge */
  edge?: Edge<NodeData, EdgeData>;
}

/**
 *
 */
export interface GraphZoomEvent {
  newScale: number;
}

/**
 * An x/y position in the graph.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Defines an axis aligned rectangle.
 */
export interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Options for configuring how the graph is layed out.
 */
export interface LayoutOptions {
  /**
   * The direction that node layers should be rendered in. For example:
   * 'top to bottom', or 'left to right'.
   */
  rankDirection?: RankDirection;

  /**
   * How nodes within a layer should be aligned. For example, all aligned
   * to the top-left of the layer.
   */
  rankAlignment?: RankAlignment;

  /**
   * The algorithim that should be used to determine what layer each node
   * belongs to.
   */
  ranker?: RankerAlgorithim;

  /**
   * The number of pixels that separate edges.
   */
  edgeSeparation?: number;

  /**
   * The number of pixels that separate layers.
   */
  rankSeparation?: number;

  /**
   * The number of pixels that separate nodes within a layer.
   */
  nodeSeparation?: number;
}

/**
 * Different directions that node layers can be rendered in.
 */
export enum RankDirection {
  TOP_TO_BOTTOM = 'TB',
  BOTTOM_TO_TOP = 'BT',
  LEFT_TO_RIGHT = 'LR',
  RIGHT_TO_LEFT = 'RL',
}

/**
 * How nodes within a layer should be aligned with each other.
 */
export enum RankAlignment {
  NONE = 'NONE',
  UP_LEFT = 'UL',
  UP_RIGHT = 'UR',
  DOWN_LEFT = 'DL',
  DOWN_RIGHT = 'DR',
}

/**
 * Different algorithims available to use to assign nodes to layers in the
 * graph.
 */
export enum RankerAlgorithim {
  NETWORK_SIMPLEX = 'network-simplex',
  TIGHT_TREE = 'tight-tree',
  LONGEST_PATH = 'longest-path',
}
