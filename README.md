## Static Hermes Native Messaging host

> [hermes](https://github.com/tmikov/hermes/tree/shermes-wasm)
> Hermes is a JavaScript engine built for fast start-up and low memory use. Its whole design centers on compiling JavaScript ahead of time: apps ship compact bytecode, or optionally native code, and the engine does as little work as possible when they launch. Hermes was created for React Native, where it is the default engine. It also runs standalone or can be embedded as a library in other programs.

### Building
See [Building](https://gist.github.com/guest271314/b10eac16be88350ffcd19387e22ad4d5#building) in [Compiling JavaScript to WASM with WASI support using Static Hermes](https://gist.github.com/guest271314/b10eac16be88350ffcd19387e22ad4d5#file-shermes-wasi-md).

```shell
git clone --branch shermes-wasm https://github.com/tmikov/hermes
```
```shell
wget --show-progress --progress=bar -H -O wasi-sdk.tar.gz \
'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-33/wasi-sdk-33.0-x86_64-linux.tar.gz' \
&& tar -xf wasi-sdk.tar.gz \
&& mv wasi-sdk-33.0-x86_64-linux wasi-sdk \
&& rm wasi-sdk.tar.gz 
```
#### Build host

```shell
mkdir hermes-builds
cd hermes-builds
export HermesSourcePath=../hermes
export WasiSdk=../wasi-sdk
cmake -G Ninja -DCMAKE_BUILD_TYPE=Release -S ${HermesSourcePath?} -B build-host
cmake --build build-host --target hermesc --target hermes --target shermes --parallel
```
#### Compile the Hermes VM to Wasm with WASI support

```shell
cmake -G Ninja -S ${HermesSourcePath?} -B build-wasm \
-DCMAKE_BUILD_TYPE=MinSizeRel \
-DCMAKE_TOOLCHAIN_FILE=${WasiSdk?}/share/cmake/wasi-sdk.cmake \
-DIMPORT_HOST_COMPILERS=build-host/ImportHostCompilers.cmake \
-DHERMES_UNICODE_LITE=ON \
-DLLVM_ENABLE_THREADS=0 \
-DHERMES_ALLOW_BOOST_CONTEXT=0 \
-DHERMES_CHECK_NATIVE_STACK=OFF
#  Build the VM and libraries
cmake --build build-wasm --target sh-demo --parallel
```

### Compile
#### Native executable
```
shermes -typed -Wc,-I. nm_shermes.ts -o nm_shermes
```

#### wasm32-wasip1

```shell
"${WasiSdk}"/bin/wasm32-wasi-clang nm_shermes.c -c \
  -O3 \
  -DNDEBUG \
  -fno-strict-aliasing -fno-strict-overflow \
  -I. \
  -I,/hermes-builds/build-wasm/lib/config \
  -I./hermes/include \
  -mllvm -wasm-enable-sjlj \
  -Wno-c23-extensions \
  -o nm_shermes.o
```

```shell
"${WasiSdk}"/bin/clang++ -O3 nm_shermes.o ./hermes-builds/build-wasm/tools/sh-demo/CMakeFiles/sh-demo.dir/cxa.cpp.obj -o nm_shermes.wasm \
  -L./hermes-builds/build-wasm/lib \
  -L./hermes-builds/build-wasm/jsi \
  -L./hermes-builds/build-wasm/tools/shermes \
  -lshermes_console_a -lhermesvmlean_a -ljsi -lwasi-emulated-mman -lsetjmp
```

## Installation and usage on Chrome and Chromium

1. Navigate to `chrome://extensions`.
2. Toggle `Developer mode`.
3. Click `Load unpacked`.
4. Select `native-messaging-shermes` folder.
5. Note the generated extension ID.
6. Open `nm_shermes.json` in a text editor, set `"path"` to absolute path of `nm_shermes` (native executable), or `nm_shermes.sh` (shellscript to execute `wasmtime nm_shermes.wasm`) and `chrome-extension://<ID>/` using ID from 5 in `"allowed_origins"` array; and make sure `wasmtime` is in `PATH` and `nm_shermes.sh` is executable (when executing `nm_shermes.wasm` with a WASM runtime). and `chrome-extension://<ID>/` using ID from 5 in `"allowed_origins"` array. 
7. Copy the file to Chrome or Chromium configuration folder, e.g., Chromium on \*nix `~/.config/chromium/NativeMessagingHosts`; Chrome dev channel on \*nix `~/.config/google-chrome-unstable/NativeMessagingHosts`.
8. To test click `service worker` link in panel of unpacked extension which is DevTools for `background.js` in MV3 `ServiceWorker`, observe echo'ed message from `shermes` Native Messaging host. To disconnect run `port.disconnect()`.

The Native Messaging host echoes back the message passed. 

For differences between OS and browser implementations see [Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#native_messaging).

## License
Do What the Fuck You Want to Public License [WTFPLv2](http://www.wtfpl.net/about/)
