# Directed Graph
load("@io_bazel_rules_sass//:defs.bzl", "sass_binary")
load("@npm_angular_bazel//:index.bzl", "ng_module")
load("@build_bazel_rules_nodejs//:defs.bzl", "rollup_bundle")

package(default_visibility = ["//visibility:public"])

licenses(["notice"])

exports_files(["LICENSE"])
exports_files(["tsconfig.json"])

sass_binary(
    name = "graph_css",
    src = "graph.scss",
    output_name = "graph.css",
    sourcemap = False,
)

ng_module(
    name = "graph",
    srcs = [
        "edge_pipe.ts",
        "graph_camera.ts",
        "graph_component.ts",
        "graph_module.ts",
        "model.ts",
        "paths.ts",
    ],
    assets = [
        ":graph_css",
        "graph.ng.html",
    ],
    deps = [
        "//window:window",
        "@npm//@angular/material",
        "@npm//@angular/core",
        "@npm//@angular/common",
        "@npm//rxjs",
        "@npm//dagre",
        "@npm//svg-pan-zoom",
    ],
)

rollup_bundle(
    name = "bundle",
    entry_point = "graph_component.ts",
    deps = [":graph"]
)
