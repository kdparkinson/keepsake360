import { rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { ForgeConfig, ForgeMakeResult, ForgePlatform } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { PublisherGitHub } from '@electron-forge/publisher-github';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// Forge names the DMG without an OS (`keepsake360-1.0.0-universal.dmg`) and
// Squirrel's installer after the package alone (`keepsake360-1.0.0 Setup.exe`),
// which leaves the release page ambiguous about which download is for which OS.
// Label the user-facing archives with the OS instead.
const OS_LABELS: Partial<Record<ForgePlatform, string>> = {
  darwin: 'macOS',
  mas: 'macOS',
  win32: 'windows',
  linux: 'linux',
};

const OS_LABELED_EXTENSIONS = ['.dmg', '.exe'];

// Squirrel also writes its auto-update feed: a `-full.nupkg` package plus a
// `RELEASES` manifest. Nothing consumes them — the app has no updater and no
// feed is published — so drop them rather than ship them in the release.
const UPDATE_FEED_EXTENSIONS = ['.nupkg'];
const UPDATE_FEED_NAMES = ['RELEASES'];

/** Rename the user-facing archives per OS and drop the files we don't ship. */
async function finalizeArtifacts(makeResults: ForgeMakeResult[]): Promise<ForgeMakeResult[]> {
  for (const result of makeResults) {
    const osLabel = OS_LABELS[result.platform];
    if (!osLabel) continue;

    const { name, productName, version } = result.packageJSON;
    const appName = String(productName ?? name);

    const artifacts = await Promise.all(
      result.artifacts.map(async (artifact) => {
        const extension = path.extname(artifact).toLowerCase();

        // Delete the file as well as the result entry: the publisher uploads
        // exactly the paths the results carry.
        if (
          UPDATE_FEED_EXTENSIONS.includes(extension) ||
          UPDATE_FEED_NAMES.includes(path.basename(artifact))
        ) {
          await rm(artifact, { force: true });
          return null;
        }

        if (!OS_LABELED_EXTENSIONS.includes(extension)) return artifact;

        const suffix = extension === '.exe' ? ' Setup' : '';
        const renamed = path.join(
          path.dirname(artifact),
          `${appName}-${version}-${osLabel}-${result.arch}${suffix}${extension}`,
        );
        if (renamed === artifact) return artifact;

        // A failed earlier make can leave the labelled file behind, and
        // rename() refuses to overwrite on Windows, so clear the way first.
        await rm(renamed, { force: true });
        await rename(artifact, renamed);
        return renamed;
      }),
    );

    result.artifacts = artifacts.filter((artifact): artifact is string => artifact !== null);
  }

  return makeResults;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Set explicitly so the app's identity is stable under Gatekeeper, the
    // keychain and any future update feed.
    appBundleId: 'com.kdparkinson.keepsake360',
    // Ad-hoc signing for now (no Developer ID yet), declared explicitly because
    // Forge's fuses plugin only re-signs the arm64 slice when osxSign is unset,
    // which leaves the x64 and arm64 slices with different file sets and breaks
    // the universal merge. Declaring it makes Packager sign the merged app once.
    // Replace `identity` with a Developer ID Application identity to ship signed.
    osxSign: {
      identity: '-',
      identityValidation: false,
      // osx-sign's built-in entitlements leave `disable-library-validation` off
      // for the main binary and the renderer/GPU helpers; only its plugin plist
      // sets it. That is fine for a signature with a Team ID, but an ad-hoc
      // signature has none, so under the hardened runtime dyld refuses to map
      // the Electron Framework ("different Team IDs") and the app dies before
      // it can draw a window. osx-sign 2.7 only honours entitlements returned
      // from `optionsForFile` (a top-level `entitlements` is ignored), so return
      // this file for every signed file, keeping the JIT permissions the
      // helpers need.
      optionsForFile: () => ({
        entitlements: path.join(import.meta.dirname, 'entitlements.mac.plist'),
      }),
    },
  },
  rebuildConfig: {},
  makers: [
    // Squirrel's `Setup.exe` installs on its own; the update-feed files it also
    // writes are dropped by the hook below.
    new MakerSquirrel({}),
    // The DMG is what people download and drag into Applications. No zip is
    // made: it only ever existed for a Squirrel.Mac update feed we don't have.
    new MakerDMG({ format: 'ULFO' }),
  ],
  publishers: [
    // `npm run release` uploads the made distributables to a draft GitHub
    // release tagged `v<version>`, so the Windows and macOS builds from CI
    // collect in one release you review before publishing it.
    // The token is read from the GITHUB_TOKEN environment variable.
    new PublisherGitHub({
      repository: {
        owner: 'kdparkinson',
        name: 'keepsake360',
      },
      // Release artifacts are collected in a draft first, so you can check
      // them before the release goes public.
      draft: true,
      generateReleaseNotes: true,
      // Without this, a re-run of a failed release job silently keeps the
      // assets the previous attempt uploaded; with it they are replaced.
      force: true,
    }),
  ],
  hooks: {
    // Runs after the makers and before the GitHub publisher, which uploads the
    // paths in the results, so the renamed files — and only those — reach the
    // release.
    postMake: async (_forgeConfig, makeResults) => finalizeArtifacts(makeResults),
  },
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
