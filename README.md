## Static Hermes Native Messaging host

> [hermes](https://github.com/tmikov/hermes/tree/shermes-wasm)
> Hermes is a JavaScript engine built for fast start-up and low memory use. Its whole design centers on compiling JavaScript ahead of time: apps ship compact bytecode, or optionally native code, and the engine does as little work as possible when they launch. Hermes was created for React Native, where it is the default engine. It also runs standalone or can be embedded as a library in other programs.

See `tmikov/hermes/tree/shermes-wasm` at [Commit `e6095b0` [SH] Changes to compile with wasi-sdk](https://github.com/tmikov/hermes/commit/e6095b028a6d34c78eb2803ec2d11650f9a925ce) and [Commit `04edc57` [SH]tools/sh-demo: conveniently experiment with native compilation](https://github.com/tmikov/hermes/commit/04edc57a7709d82b83e37ca451ce1b55b850ce2a) for WASI support and compilation details.

### Fetch release

```shell
curl -L https://github.com/guest271314/hermes/releases/download/sdk-latest/shermes-wasm-sdk-linux-x86_64.tar.gz | tar -xv
```

### Building
See [Building](https://gist.github.com/guest271314/b10eac16be88350ffcd19387e22ad4d5#building) in [Compiling JavaScript to WASM with WASI support using Static Hermes](https://gist.github.com/guest271314/b10eac16be88350ffcd19387e22ad4d5#file-shermes-wasi-md).
```shell
sudo apt install python3-pygments python3-yaml
```
```shell
git clone https://github.com/guest271314/native-messaging-shermes
cd native-messaging-shermes
git clone --branch shermes-wasm https://github.com/tmikov/hermes static-hermes-wasm
```
```shell
curl -L "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/wasi-sdk-25.0-x86_64-linux.tar.gz" | tar -xz --one-top-level="wasi-sdk-25"
```

```shell
export HermesSourcePath=$PWD/static-hermes-wasm
export WasiSdk=$PWD/wasi-sdk-25
```
#### Build host

```shell
cmake --build build-host --target hermesc --target hermes --target shermes \
--target shermes_console_a --target shermes_console --target hermesvmlean_a --parallel
```
#### Compile the Hermes VM to Wasm with WASI support

```shell
cmake -S ${HermesSourcePath?} -B build-wasm \
-DCMAKE_BUILD_TYPE=MinSizeRel \
-DCMAKE_TOOLCHAIN_FILE=${WasiSdk?}/share/cmake/wasi-sdk.cmake \
-DIMPORT_HOST_COMPILERS=build-host/ImportHostCompilers.cmake \
-DHERMES_UNICODE_LITE=ON \
-DLLVM_ENABLE_THREADS=0 \
-DHERMES_ALLOW_BOOST_CONTEXT=0 \
-DHERMES_CHECK_NATIVE_STACK=OFF \
-DHERMES_ENABLE_INTL=OFF
#  Build the VM and libraries
cmake --build build-wasm --target sh-demo --parallel
```

### Compile
#### Native executable
```
./build-host/bin/shermes -typed -Wc,-I. nm_shermes.ts -o nm_shermes
```

Alternatively, using this source for `nm_shermes.ts`

```shell
(function (exports) {
  const _nativeMessagingHost = $SHBuiltin.extern_c(
    { include: "/home/user/native-messaging-shermes/nm_c_nostartup.c" },
    function nativeMessagingHost(): c_int {
      throw 0;
    },
  );

 _nativeMessagingHost();
})({});
```

```shell
./build-host/bin/shermes -typed -Wc,-nostartfiles,-I. nm_shermes.ts -o nm_shermes
```


#### wasm32-wasip1

##### Emit C
```shell
./build-host/bin/shermes -v -Os -g -fauto-detect-static-builtins -typed \
  -Xenable-tdz -emit-c nm_shermes.ts -o nm_shermes.c```

##### Create object file

```shell
"${WasiSdk}"/bin/clang nm_shermes.c -c \
  -O3 \
  -DNDEBUG \
  -fno-strict-aliasing -fno-strict-overflow \
  -I. \
  -I./build-wasm/lib/config \
  -I./static-hermes-wasm/include \
  -mllvm -wasm-enable-sjlj \
  -Wno-c23-extensions \
  -o nm_shermes.o
```

##### Compile object file wo wasm32-wasip1

```shell
"${WasiSdk}"/bin/clang++ -O3 nm_shermes.o \
  ./build-wasm/tools/sh-demo/CMakeFiles/sh-demo.dir/cxa.cpp.obj \
   -o nm_shermes.wasm \
  -L./build-wasm/lib \
  -L./build-wasm/jsi \
  -L./build-wasm/tools/shermes \
  -lshermes_console_a -lhermesvmlean_a -ljsi -lwasi-emulated-mman -lsetjmp
```
##### Strip WASM binary
```shell
"${WasiSdk}"/bin/strip -s nm_shermes.wasm
```

## Installation and usage on Chrome and Chromium

1. Navigate to `chrome://extensions`.
2. Toggle `Developer mode`.
3. Click `Load unpacked`.
4. Select `native-messaging-shermes` folder.
5. Note the generated extension ID.
6. Open `nm_shermes.json` in a text editor, set `"path"` to absolute path of `nm_shermes` (native executable), or `nm_shermes.sh` (shellscript to execute `wasmtime nm_shermes.wasm`) and `chrome-extension://<ID>/` using ID from 5 in `"allowed_origins"` array; and make sure `wasmtime` is in `PATH` and `nm_shermes.sh` is executable (when executing `nm_shermes.wasm` with a WASM runtime). 
7. Copy the file to Chrome or Chromium configuration folder, e.g., Chromium on \*nix `~/.config/chromium/NativeMessagingHosts`; Chrome dev channel on \*nix `~/.config/google-chrome-unstable/NativeMessagingHosts`.
8. To test click `service worker` link in panel of unpacked extension which is DevTools for `background.js` in MV3 `ServiceWorker`, observe echo'ed message from Hermes `static_h` branch (`shermes`) Native Messaging host. To disconnect run `port.disconnect()`.

The Native Messaging host echoes back the message passed. 

For differences between OS and browser implementations see [Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#native_messaging).

## License
Do What the Fuck You Want to Public License [WTFPLv2](http://www.wtfpl.net/about/)
