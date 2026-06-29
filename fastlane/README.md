fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios certificates

```sh
[bundle exec] fastlane ios certificates
```

Create (or download) the Apple Distribution certificate and export a .p12

for the IOS_DIST_CERT_BASE64 GitHub secret. Run once, then export/encode the

result. Pass an output dir + password, e.g.:

  bundle exec fastlane ios certificates dist_cert_password:hunter2

### ios build

```sh
[bundle exec] fastlane ios build
```

Build a signed iOS release IPA from the Capacitor app

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build an App Store IPA and upload it to TestFlight

----


## Android

### android build

```sh
[bundle exec] fastlane android build
```

Build a local Android release APK from the Capacitor app

### android bundle

```sh
[bundle exec] fastlane android bundle
```

Build an Android release AAB for signing and Play Console upload

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
