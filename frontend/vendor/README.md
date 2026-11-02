# Vendored packages

## `@qontinui/studio-scenes` (the marketing site's scene player)

`qontinui-studio-scenes-<version>.tgz` is the studio's embeddable scene
player. It is built by `pnpm embed:pack` in
[qontinui-studio](https://github.com/qontinui/qontinui-studio) `scenes/`. It is
not published to npm. `package.json` installs it as a `file:` dependency, and
`package-lock.json` pins its integrity.

`studio-scenes.pin.json` records which studio commit the tarball was packed
from, and its SHA-256. The studio's `embed-package` CI job prints the SHA-256
for every commit, so anyone can check the vendored copy against that commit.
`src/components/studio/studio-scenes.test.ts` checks the following:

- the tarball's SHA-256 matches the pin;
- `public/studio/fonts/` and `public/studio/posters/` are byte-identical
  copies of the files in the vendored tarball. The page serves
  them: the posters render before the player loads, and the player loads the
  fonts from there;
- every scene the site shows is ILLUSTRATIVE in the package manifest.

To update:

```bash
# in qontinui-studio/scenes, at the commit to vendor
pnpm install --frozen-lockfile && pnpm browser:ensure && pnpm embed:pack
# in qontinui-web/frontend
cp <studio>/scenes/out/embed/qontinui-studio-scenes-<version>.tgz vendor/
npm install ./vendor/qontinui-studio-scenes-<version>.tgz
rm -rf public/studio/fonts public/studio/posters
cp -r node_modules/@qontinui/studio-scenes/fonts public/studio/fonts
cp -r node_modules/@qontinui/studio-scenes/posters public/studio/posters
# then set studio_commit, sha256 and (on a version change) tarball in
# studio-scenes.pin.json, and delete the old tarball; npm install has already
# updated package.json and package-lock.json
```

Remotion (`remotion`, `@remotion/player`) is a peer dependency of the player
and is installed directly. It is not AGPL: see the repository's `NOTICE` for
the AGPL section 7 permission that covers it.
