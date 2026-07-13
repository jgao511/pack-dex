# Scanner Pixel real-photo variant regression

This scanner-only regression uses the four supplied Pixel JPEGs as opaque `Blob` bytes. It does not pass card names, collector numbers, set IDs, or card IDs into proposal generation or matching. Expected IDs are consulted only after ranking, in test assertions and diagnostics.

Pipeline under test: real JPEG bytes → `Blob` decode → current bounded card proposals (maximum 12) → v2 structural score over all 18,747 trusted descriptors → full regional rerank of the strongest 640 → top-40 recall. ORB is then run against identity-blind top-20 lists where the expected card entered that list.

## Untouched Pixel originals

| Photo | Best proposal | Lightweight rank | ORB rank | ORB evidence |
|---|---|---:|---:|---|
| Here Comes Team Rocket 113/108 | contour-1 | 1 | 1 | 268 good / 255 inliers |
| Diglett 55/108 | centered-aspect-8 | 1 | 1 | 284 good / 257 inliers |
| Gardevoir-EX 111/114 | min-area-rect-1 | 1 | 1 | 22 good / 16 inliers |
| Mega Charizard X ex 013/094 | no identity-blind top-640 proposal | >640 | not run | Must be recovered by OCR/name-number recall before ORB |

The first three originals were ORB rank 1 in all three bounded ORB runs. Mega Charizard is deliberately reported as a visual-recall failure in this isolated harness; the test does not inject its expected ID to manufacture an ORB success.

## Real-photo-derived variants

Ranks are the best expected-card rank from any non-fallback proposal after the full v2 rerank. `>640` means the expected card did not survive the structural recall cutoff.

| Card | Original | More table | 3.5° rotation | Mild blur | Foil glare | Offset outline |
|---|---:|---:|---:|---:|---:|---:|
| Here Comes Team Rocket | 1 | 2 | 2 | 1 | 2 | 1 |
| Diglett | 1 | 87 | 1 | 1 | 1 | 1 |
| Gardevoir-EX | 1 | 1 | 1 | 1 | 1 | 1 |
| Mega Charizard X ex | >640 | >640 | 86 | >640 | 485 | >640 |

Summary: 20/24 variant cases retained the expected card in the top-640 identity-blind visual recall pool; 17/24 were top 40; 14/24 were rank 1. Team Rocket’s rank-2 cases are visually close to the original Team Rocket printing, and are therefore reported rather than converted into false top-1 claims. Diglett with substantially more table remained available at rank 87. The four misses are all Mega Charizard variants and document why OCR-derived name/number candidates must remain part of the union before ORB.

The final measured variant-recall run took 48.6 seconds on the development machine. The separate bounded ORB regression reranks three eligible original-photo shortlists. This is a regression workload, not per-scan mobile timing.
