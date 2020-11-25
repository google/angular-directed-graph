workspace(name = "directed-graph")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "bazel_skylib",
    sha256 = "2c62d8cd4ab1e65c08647eb4afe38f51591f43f7f0885e7769832fa137633dcb",
    strip_prefix = "bazel-skylib-0.7.0",
    urls = [
        # tag 0.7.0 resolves to commit 6741f733227dc68137512161a5ce6fcf283e3f58 (2019-02-08 18:37:26 +0100)
        "http://mirror.tensorflow.org/github.com/bazelbuild/bazel-skylib/archive/0.7.0.tar.gz",
        "https://github.com/bazelbuild/bazel-skylib/archive/0.7.0.tar.gz",
    ],
)

http_archive(
    name = "io_bazel_rules_webtesting",
    sha256 = "f89ca8e91ac53b3c61da356c685bf03e927f23b97b086cc593db8edc088c143f",
    urls = [
        # tag 0.3.1 resolves to commit afa8c4435ed8fd832046dab807ef998a26779ecb (2019-04-03 14:10:32 -0700)
        "http://mirror.tensorflow.org/github.com/bazelbuild/rules_webtesting/releases/download/0.3.1/rules_webtesting.tar.gz",
        "https://github.com/bazelbuild/rules_webtesting/releases/download/0.3.1/rules_webtesting.tar.gz",
    ],
)

http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "7c4a690268be97c96f04d505224ec4cb1ae53c2c2b68be495c9bd2634296a5cd",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/0.34.0/rules_nodejs-0.34.0.tar.gz"],
)

http_archive(
    name = "io_bazel_rules_sass",
    sha256 = "4f05239080175a3f4efa8982d2b7775892d656bb47e8cf56914d5f9441fb5ea6",
    url = "https://github.com/bazelbuild/rules_sass/archive/86ca977cf2a8ed481859f83a286e164d07335116.zip",
    strip_prefix = "rules_sass-86ca977cf2a8ed481859f83a286e164d07335116",
)

load("@build_bazel_rules_nodejs//:defs.bzl", "node_repositories", "yarn_install")
node_repositories()

yarn_install(
    name = "npm",
    package_json = "//:package.json",
    yarn_lock = "//:yarn.lock",
    # Opt out of symlinking local node_modules folder into bazel internal
    # directory.  Symlinking is incompatible with our toolchain which often
    # removes source directory without `bazel clean` which creates broken
    # symlink into node_modules folder.
    symlink_node_modules = False,
    data = [
        # package.json contains postinstall that requires this file.
        "//:angular-metadata.tsconfig.json",
    ],
)

load("@npm//:install_bazel_dependencies.bzl", "install_bazel_dependencies")
install_bazel_dependencies()

load("@io_bazel_rules_sass//sass:sass_repositories.bzl", "sass_repositories")
sass_repositories()
