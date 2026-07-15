# PackDex real Pixel scanner acceptance

Validated on a connected Pixel 6a using the scanner-test APK. Each supplied JPEG was fetched from the scanner-only bundle, converted to a real browser `Blob` and neutral `File`, wrapped in the same temporary object-URL representation as Choose Photo, and passed through ordinary preparation, native ML Kit OCR, local visual search, ORB/RANSAC, and fusion. Expected IDs were used only after recognition to grade the output.

## Baseline loss point

| Photo | Baseline boundary / crop | Correct lightweight rank | ORB | Baseline final |
| --- | --- | ---: | --- | --- |
| Here Comes Team Rocket | Contour rectified | 2 | 1 | 1, medium |
| Diglett | Boundary failed; complete table photo | 11,113 | Not shortlisted | Absent |
| Gardevoir-EX | Boundary failed; complete table photo | 536 | Correct OCR candidate was truncated before ORB | Absent |
| Mega Charizard X ex | Boundary failed; complete table photo | 9,745 | Not shortlisted | Absent |

This confirmed that confidence thresholds were not the primary problem. The correct card was being lost during crop selection and candidate recall.

## Final Pixel File/Blob results

| Photo | Selected proposal | OCR evidence | Correct lightweight rank | ORB shortlist / rank | Final | Confidence | Total time |
| --- | --- | --- | ---: | --- | ---: | --- | ---: |
| Here Comes Team Rocket 113/108 | Exact contour | Name read; number not recovered | 3 | Yes / 1; 124 inliers | 1 | Medium | 7,375.6 ms cold |
| Diglett 55/108 | Centered card-aspect crop | `Diglett`; collector number not reliably recovered | >40 (1,382 in exhaustive local check) | Yes / 1; 84 inliers | 1 | Medium | 5,776.7 ms |
| Gardevoir-EX 111/114 | Min-area rectangle | `Gardevoir EX`, `111/114` | 1 | Yes / 5; 9 inliers | 1 | High | 6,106.5 ms |
| Mega Charizard X ex 013/094 | Centered card-aspect crop | `Mega Charizard X eN`, repaired locally to `ex`; number not reliably recovered | >40 (4,505 in exhaustive local check) | Yes / 1; 58 inliers | 1 | Medium | 6,055.5 ms |

The Team Rocket photo has visually near-identical trusted vintage printings. The supplied Evolutions printing still finishes first because its ORB result is strongest: 99.2%, 128 good matches, and 124 inliers.

The first run includes lazy scanner-worker/OpenCV startup. The other three complete in approximately 5.8–6.1 seconds. Proposal generation, full-catalog recall, and ORB execute in the scanner worker; native ML Kit calls remain outside the worker.

## Final implementation characteristics

- 9–10 bounded proposals per supplied photo.
- Exact contour, min-area rectangle, Hough-line, centered scale/offset, camera-outline, and last-resort full-image sources.
- ML Kit runs against every proposal; block coordinates contribute a card-spanning text-cluster score.
- Full-catalog structural recall uses a coarse local pass followed by the complete multi-region descriptor on a bounded recall set.
- Top 40 lightweight candidates are unioned with trusted OCR name/number/total evidence.
- At most 20 candidates enter ORB.
- Candidates are exposed only when OCR-compatible or backed by strong visual plus ORB evidence.
- No cloud vision, uploads, persistence, Collection/Wishlist actions, or expected-card injection.
