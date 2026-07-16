# PackDex branding assets

`source/packdex-icon-master-1024.png` is the sole canonical, fully opaque 1024×1024 PackDex app-icon master. The supplied final upload measured 1254×1254, so it was resized once with Lanczos resampling to meet the required 1024×1024 platform-master specification. No other crop, mask, recolor, transparency, or artwork edit is applied.

Run `npm run generate:branding` after deliberately replacing the canonical master. The generator writes all public, iOS, and Android icon and legacy splash variants. `public/packdex-small.png` (192×192) and `public/packdex-large.png` (512×512) remain as compatibility URLs for already-deployed pages and installed PWAs; active application code uses the purpose-specific `packdex-icon-192.png` or `packdex-icon-512.png` files instead.
