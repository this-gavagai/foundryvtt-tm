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

### ios unsigned

```sh
[bundle exec] fastlane ios unsigned
```

Build an unsigned IPA for sideloading (Sideloadly, AltStore)

Deliberately unsigned: whoever installs it re-signs with their own Apple ID,

so our signature would only be stripped again. That also means this lane needs

no certificate, profile, or App Store Connect key — unlike every other iOS lane.

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Build an App Store IPA and upload it to TestFlight

----


## Android

### android keystore

```sh
[bundle exec] fastlane android keystore
```

Create a self-signed upload keystore and print the GitHub secrets to add.

Android sideload signing needs no Apple-style portal round-trip: this just

wraps keytool. Run once, e.g.:

  bundle exec fastlane android keystore key_password:hunter2

### android build

```sh
[bundle exec] fastlane android build
```

Build a signed Android release APK from the Capacitor app for sideloading

### android bundle

```sh
[bundle exec] fastlane android bundle
```

Build an Android release AAB for signing and Play Console upload

### android play

```sh
[bundle exec] fastlane android play
```

Build the release AAB and upload it to a Play track.

Track names predate the Console's labels: internal, alpha (= closed

testing), beta (= open testing), production. Defaults to internal.

  bundle exec fastlane android play track:alpha

### android play_metadata

```sh
[bundle exec] fastlane android play_metadata
```

Push the store listing images (icon, feature graphic, screenshots) from

fastlane/metadata to Play. Separate from the play lane on purpose: this

overwrites what's in the Console, so it should be a deliberate act.

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
