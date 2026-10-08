"""Builds the itch.io HTML5 zip: python tools/build-itch.py  ->  tools/out/shoot-unlimited-itch.zip
index.html sits at the zip root; no sw.js (portal iframes skip the offline cache anyway), no tools/docs/md."""
import zipfile, glob, os
root = os.path.join(os.path.dirname(__file__), '..')
files = ['index.html', 'manifest.webmanifest', 'icon.svg', 'fonts/russo-one.woff2', 'fonts/OFL.txt'] + sorted(os.path.relpath(f, root).replace(os.sep, '/') for f in glob.glob(os.path.join(root, 'js', '*.js')))
out = os.path.join(root, 'tools', 'out', 'shoot-unlimited-itch.zip'); os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in files: z.write(os.path.join(root, f), f)
print(os.path.abspath(out), os.path.getsize(out), 'bytes,', len(files), 'files')
