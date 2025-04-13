# Chapter 10: Build System & Packaging

Welcome to the final chapter of the TUXEDO Control Center (TCC) developer tutorial! In the previous chapters, we explored all the different software components that make TCC work, from the performance profiles ([Chapter 1](01_tccprofile__performance_profiles_.md)) and the user interface ([Chapter 2](02_angular_frontend__ng_app_.md)) to the background daemon ([Chapter 4](04_tuxedocontrolcenterdaemon__tccd_.md)) and its workers/listeners ([Chapter 9](09_daemonworker___daemonlistener.md)). We saw how these parts interact with configuration files ([Chapter 6](06_configuration_handling__confighandler_.md)) and hardware ([Chapter 7](07_tuxedoioapi__native_binding_.md), [Chapter 8](08_sysfspropertyio___sysfscontroller.md)).

But how do we get from all that source code, written in TypeScript, C++, and HTML/CSS, to a single, installable package (`.deb` or `.rpm` file) that users can easily put on their TUXEDO laptops? That's where the **Build System & Packaging** process comes in.

## What Problem Does the Build System Solve?

Imagine you've written a fantastic recipe (the source code). You can't just hand someone the raw ingredients and expect them to have a finished meal. You need to follow the recipe steps: prepare the ingredients (compile), cook them together (build), and put the meal in a nice container (package) for delivery.

Similarly, the source code for TCC isn't directly usable by end-users. It needs to be processed:
*   TypeScript code needs to be translated into JavaScript that Node.js and browsers understand.
*   C++ code for native bindings needs to be compiled into a format Node.js can load.
*   The Angular frontend needs to be optimized and bundled into efficient web assets (HTML, CSS, JavaScript).
*   All these processed pieces, along with images, configuration templates, and system service files, need to be assembled into the correct directory structure.
*   Finally, this assembled application needs to be bundled into a standard Linux package format (`.deb` for Debian/Ubuntu/TUXEDO OS, `.rpm` for Fedora/openSUSE) that includes installation instructions and dependency information.

The **Build System** is the collection of tools, scripts, and configuration files that automates this entire "recipe" – turning the source code ingredients into a ready-to-install TCC application package.

**Use Case:** How does the TCC development team take the code hosted on GitHub and produce the `tuxedo-control-center_*.deb` file that users install? The build system defines and executes all the necessary steps.

## Key Concepts (The Factory Tools)

Think of the build system as TCC's automated factory. Here are the main tools used on the assembly line:

1.  **`package.json` (The Master Blueprint & Foreman):**
    *   This file is the heart of most Node.js projects. For the build system, its most important part is the `"scripts"` section.
    *   **Scripts:** These are like commands given to the factory foreman (the `npm` or `yarn` command-line tool). You can define custom commands like `"build"` or `"pack"`. Running `npm run build` tells `npm` to execute the sequence of steps defined for `"build"` in `package.json`. These steps usually call the other tools listed below.

2.  **`tsc` (TypeScript Compiler - The Translator):**
    *   Since much of TCC (the [Electron Main Process (e-app)](03_electron_main_process__e_app_.md), the [TuxedoControlCenterDaemon (tccd)](04_tuxedocontrolcenterdaemon__tccd_.md), common code) is written in TypeScript, we need to translate it into JavaScript.
    *   `tsc` reads TypeScript files (`.ts`) and configuration files (`tsconfig.json`) and outputs JavaScript files (`.js`) that Node.js can run.

3.  **`ng` (Angular CLI - The Frontend Specialist):**
    *   The [Angular Frontend (ng-app)](02_angular_frontend__ng_app_.md) is complex. The Angular CLI (`ng`) is a specialized toolset for managing Angular projects.
    *   The `ng build` command does many things: it uses `tsc` internally, but also bundles the code efficiently, optimizes assets (like images and CSS), handles internationalization (different languages), and prepares the frontend for deployment, placing the output in a specified directory (configured in `angular.json`).

4.  **`node-gyp` (Native Module Builder - The C++ Machinist):**
    *   TCC uses a C++ native binding, the [TuxedoIOAPI (Native Binding)](07_tuxedoioapi__native_binding_.md), to talk to specific hardware.
    *   `node-gyp` is the tool used to compile this C++ code (using system compilers like `g++`) into a `.node` file (e.g., `TuxedoIOAPI.node`) that Node.js can load using `require()`. It reads instructions from a `binding.gyp` file.

5.  **`electron-builder` (The Packager - The Boxing Machine):**
    *   Once all the code is compiled and assets are gathered, `electron-builder` takes over.
    *   It reads its configuration (from `package.json` or a separate file like `build-src/electron-builder.ts`) which specifies things like:
        *   The application name, version, description.
        *   Which files and directories make up the application.
        *   Which "extra resources" (like service files, icons, policykit rules) need to be included and where they should be installed on the user's system.
        *   Which package formats to create (`deb`, `rpm`).
        *   Installation dependencies (like `tuxedo-drivers`).
        *   Scripts to run after installation or before removal.
    *   It then intelligently packages everything into the final `.deb` or `.rpm` files, ready for distribution.

## The Assembly Line: Building TCC

Let's follow the factory process, typically kicked off by a command like `npm run build` or `npm run pack-prod` defined in `package.json`.

```mermaid
graph LR
    A[Source Code (.ts, .cc, .html, .scss)] --> B{npm run build};
    B --> C(Clean Old Build);
    C --> D(Compile Native Module<br>node-gyp);
    C --> E(Compile Backend TS<br>tsc);
    C --> F(Build Frontend<br>ng build);
    D --> G{Assemble Files in 'dist'};
    E --> G;
    F --> G;
    G --> H(Copy Assets & Resources);
    H --> I{npm run electron-builder};
    I --> J(Package<br>electron-builder);
    J --> K[Installable Packages<br>(.deb, .rpm)];

    style B fill:#f9f,stroke:#333,stroke-width:2px
    style I fill:#f9f,stroke:#333,stroke-width:2px
```

*This diagram shows the flow: Source code goes into the `npm run build` command. This cleans up, compiles native code (`node-gyp`), compiles backend TypeScript (`tsc`), and builds the frontend (`ng build`). The results are assembled in a temporary `dist` directory, extra assets are copied in, and finally `npm run electron-builder` uses `electron-builder` to create the final packages.*

Here's a breakdown of the steps, often defined using `npm-run-all` (tool `run-s`) in `package.json` to run scripts sequentially:

1.  **Cleanup (`clean` script):** Remove the previous build output directories (`dist`, `build`) to ensure a fresh start.
    ```bash
    # Example from package.json script
    rm -rf ./dist; rm -rf ./build; rm -rf ./usr
    ```

2.  **Compile Native Module (`build-native` script):** Run `node-gyp` to compile the C++ code in `src/native-lib` into `TuxedoIOAPI.node` inside the `build` directory.
    ```bash
    # Example from package.json script
    node-gyp configure && node-gyp rebuild
    ```

3.  **Compile Backend TypeScript (`build-electron`, `build-service` scripts):** Run `tsc` separately for the Electron main process (`e-app`) and the daemon (`service-app`). The `tsconfig.json` files for each specify where to put the JavaScript output (usually within the `dist` directory).
    ```bash
    # Example from package.json scripts
    tsc -p ./src/e-app
    tsc -p ./src/service-app
    ```

4.  **Build Angular Frontend (`build-ng` or `build-ng-prod` scripts):** Run `ng build` (with the `--prod` flag for release builds). This compiles the Angular app, optimizes it, and places the resulting static HTML, CSS, and JS files into the path specified in `angular.json` (usually within `dist`).
    ```bash
    # Example from package.json scripts
    ng build --prod
    ```

5.  **Assemble & Copy Files (`copy-files` scripts):** This involves several small steps:
    *   Copy the compiled `TuxedoIOAPI.node` from `build` to where the `service-app` expects it in `dist`.
    *   Copy essential files like `package.json` (needed by Electron) into `dist`.
    *   Copy static assets (icons, images, `.desktop` files, policy files, service files, changelog) from `src/dist-data` and other locations into a structured layout within `dist`, mirroring where they will eventually be installed.
    ```bash
    # Example from package.json scripts
    cp ./build/Release/TuxedoIOAPI.node ./dist/tuxedo-control-center/service-app/native-lib
    cp ./src/package.json ./dist/tuxedo-control-center/package.json
    cp -r ./src/dist-data ./dist/tuxedo-control-center/data
    # ... other copy commands ...
    ```

6.  **Package (`electron-builder` script):** Run the `electron-builder` command (potentially via a helper script like `build-src/electron-builder.ts`). `electron-builder` reads its configuration, looks at the assembled application in `dist`, gathers all specified files and resources, and generates the `.deb` and/or `.rpm` packages in a final output directory (e.g., `dist/packages`).
    ```bash
    # Example from package.json script
    USE_HARD_LINKS=false TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node ./build-src/electron-builder.ts
    ```

After these steps, you have the final, installable TCC packages!

## Under the Hood: Configuration Files

Let's peek at simplified versions of the key configuration files that guide these tools.

**1. `package.json` (Relevant Scripts)**

This shows how scripts chain together using `run-s` (run-sequentially) from `npm-run-all`.

```json
// Simplified from package.json
{
  "name": "tuxedo-control-center",
  "version": "2.1.16",
  "main": "./dist/tuxedo-control-center/e-app/e-app/main.js", // Entry point for Electron
  "scripts": {
    // Runs all build steps sequentially for development
    "build": "run-s clean build-electron build-native build-service build-ng copy-files",
    // Runs all build steps for production (optimized Angular build)
    "build-prod": "run-s clean build-electron build-native build-service build-ng-prod copy-files",

    // Individual build steps
    "build-ng": "ng build",
    "build-ng-prod": "ng build --prod",
    "build-electron": "tsc -p ./src/e-app",
    "build-service": "tsc -p ./src/service-app && cp ... && run-s bundle-service", // Service build has extra steps
    "build-native": "node-gyp configure && node-gyp rebuild",
    "copy-files": "run-s copy-package-json copy-dist-files copy-cameractls copy-udev-rule",
    "clean": "rm -rf ./dist; rm -rf ./build; rm -rf ./usr",

    // Packaging step (runs after build)
    "electron-builder": "USE_HARD_LINKS=false TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node ./build-src/electron-builder.ts",
    // Combines build and packaging
    "pack-prod": "run-s build-prod && npm run electron-builder"
  },
  "devDependencies": {
    // Tools used in the scripts
    "electron": "^13.6.9",
    "electron-builder": "^21.2.0",
    "node-gyp": "implied dependency",
    "typescript": "~4.0.8",
    "@angular/cli": "~10.2.4",
    "npm-run-all": "^4.1.5",
    "ts-node": "^10.7.0"
    // ... other dependencies
  }
}
```

*This shows how high-level scripts like `build-prod` are composed of smaller, sequential steps defined using `run-s`. The `pack-prod` script first runs `build-prod` and then runs the `electron-builder` script. The `devDependencies` section lists the tools needed for the build.*

**2. `tsconfig.json` (Example for `service-app`)**

This tells the TypeScript compiler (`tsc`) how to compile the daemon code.

```json
// Simplified from src/service-app/tsconfig.json
{
  "extends": "../../tsconfig.json", // Inherits common settings
  "compilerOptions": {
    // highlight-next-line
    "outDir": "../../dist/tuxedo-control-center/service-app", // Where to put JS output
    "rootDir": "../", // Root of source files relative to this config
    "module": "commonjs", // JS module system for Node.js
    "types": ["node"], // Include Node.js type definitions
    "target": "es6" // Output modern-ish JavaScript
  },
  "exclude": [
    "test.ts", // Don't compile test files
    "**/*.spec.ts" // Don't compile Angular spec files
  ]
}
```

*The key option here is `"outDir"`, telling `tsc` to place the compiled JavaScript files for the `service-app` into the `dist/tuxedo-control-center/service-app` directory. Similar `tsconfig.json` files exist for `e-app`.*

**3. `angular.json` (Relevant Build Options)**

This tells the Angular CLI (`ng`) where to put the built frontend files.

```json
// Simplified from angular.json
{
  "projects": {
    "tuxedo-control-center": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src/ng-app",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:browser",
          "options": {
            // highlight-next-line
            "outputPath": "dist/tuxedo-control-center/ng-app", // Where to put built frontend
            "index": "src/ng-app/index.html",
            "main": "src/ng-app/main.ts",
            "tsConfig": "tsconfig.app.json",
            // ... other assets, styles, scripts ...
          },
          "configurations": {
            "production": {
              // Production-specific optimizations
              "optimization": true,
              "outputHashing": "all",
              "sourceMap": false,
              // ...
            }
          }
        }
        // ... other sections like 'serve', 'test', 'lint' ...
      }
    }
  }
}
```

*The important part is `projects.tuxedo-control-center.architect.build.options.outputPath`. This tells `ng build` to put the final optimized frontend files into `dist/tuxedo-control-center/ng-app`.*

**4. `build-src/electron-builder.ts` (Packaging Configuration)**

This script configures `electron-builder` to create the `.deb` and `.rpm` packages.

```typescript
// Simplified from build-src/electron-builder.ts
import * as builder from 'electron-builder';

const distSrc = './dist/tuxedo-control-center'; // Base path of built app

// --- Configuration for DEB package ---
async function buildDeb(filenameAddition: string): Promise<void> {
    const config: builder.Configuration = {
        appId: 'tuxedocontrolcenter',
        artifactName: '${productName}_${version}' + filenameAddition + '.${ext}', // Naming pattern
        directories: {
            output: './dist/packages' // Where to put final packages
        },
        // Files included *inside* the Electron app bundle
        files: [
            distSrc + '/**/*' // Include everything built into distSrc
        ],
        // Additional files needed for system installation
        // highlight-start
        extraResources: [
            // The compiled daemon executable
            distSrc + '/data/service/tccd',
            // The native module needed by the daemon
            distSrc + '/data/service/TuxedoIOAPI.node',
            // Systemd service files
            distSrc + '/data/dist-data/tccd.service',
            distSrc + '/data/dist-data/tccd-sleep.service',
            // Icons and Desktop entries
            distSrc + '/data/dist-data/tuxedo-control-center_256.svg',
            distSrc + '/data/dist-data/tuxedo-control-center.desktop',
            // PolicyKit rule for permissions
            distSrc + '/data/dist-data/com.tuxedocomputers.tccd.policy',
            // DBus configuration file
            distSrc + '/data/dist-data/com.tuxedocomputers.tccd.conf',
            // Camera helper script
            distSrc + '/data/camera/cameractrls.py',
            // Webcam udev rule
            distSrc + '/data/dist-data/99-webcam.rules',
            // ... other necessary files ...
        ],
        // highlight-end
        linux: {
            target: ['deb'], // Specify package type
            category: 'System', // Application category
        },
        deb: {
            // Installation dependencies
            depends: ['tuxedo-drivers (>= 4.0.0) | tuxedo-keyboard (>= 3.1.2)', 'libayatana-appindicator3-1'],
            // Scripts to run after install/remove
            afterInstall: "./build-src/after_install.sh",
            afterRemove: "./build-src/after_remove.sh",
            // Advanced options passed to the underlying 'fpm' tool
            fpm: [
                '--conflicts=tuxedofancontrol', // Conflicts with older package
                '--replaces=tuxedofancontrol', // Replaces older package
                '--inputs=build-src/package-files.txt' // List of where to install extraResources
            ]
        }
    };
    await builder.build({ /* ... call builder ... */ });
}

// --- Configuration for RPM package --- (Similar structure, different depends/fpm options)
async function buildRpm(filenameAddition: string): Promise<void> { /* ... RPM specific config ... */ }

// --- Script execution logic ---
// ... code to parse command line arguments and call buildDeb/buildRpm ...
```

*This configuration tells `electron-builder` everything it needs. `files` specifies the core application content. `extraResources` is crucial – it lists all the additional system files (service definitions, icons, policy rules, native modules for the daemon) that need to be packaged and installed correctly. The `deb` (and `rpm`) sections define dependencies, post-install scripts, and other package metadata.*

## Conclusion

Congratulations! You've reached the end of the TUXEDO Control Center developer tutorial.

In this final chapter, you learned about the **Build System & Packaging** process:

*   It automates the transformation of TCC's source code into installable packages.
*   It uses a suite of tools orchestrated by `npm scripts` in `package.json`:
    *   `tsc` compiles backend TypeScript.
    *   `ng build` compiles and bundles the Angular frontend.
    *   `node-gyp` compiles the C++ native addon.
    *   Helper scripts copy necessary assets and files.
    *   `electron-builder` assembles everything and creates the final `.deb` and `.rpm` packages based on detailed configuration.

This build system acts like an automated factory, ensuring that all the complex components we've discussed in previous chapters are correctly compiled, assembled, and packaged for users to easily install and run TUXEDO Control Center on their machines.

We hope this tutorial has given you a solid understanding of the different parts of TUXEDO Control Center and how they work together. Happy coding!

---

Generated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)