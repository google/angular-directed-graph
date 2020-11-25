# Directed Graph Component for Angular

This is a modular component to render an SVG graph of nodes connected by edges.

By default, each node is rendered as a box, with curved lines connecting them.

This can be customized by providing your own templates to render the node and
edges.

Data is expected to be supplied to the graph as basic `Node` and `Edge` objects
(see `model.ts`). These interfaces may be optionally parameterized  to wrap
custom data specific to you graph. `Node` and `Edge` objects are passed to the
custom templates so you may access your custom data in your templates.

## Example usage

Create a simple graph using the default rendering options:

```
@Component({
  template: `<directed-graph [graph]="myGraphData"></directed-graph>`,
  ...
})
export class MyGraph {
  node1 = {id: 'Node 1', width: 100, height: 50};
  node2 = {id: 'Node 2', width: 100, height: 50};
  edge1 = {src: this.node1, dest: this.node2, points: []};
  myGraphData = {
    nodes: [this.node1, this.node2],
    edges: [this.edge1],
  };
}
```
