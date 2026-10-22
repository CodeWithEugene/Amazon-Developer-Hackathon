# VisitProof Demo Video

A silent, captioned demo of the real app for the Devpost submission, under
three minutes, ready for a human voiceover. One command starts the demo,
records every scene with Playwright, and assembles the cut with ffmpeg.

## Requirements

- Node 22 or later and pnpm (the repository's own `pnpm install`).
- Playwright's Chromium: `pnpm exec playwright install chromium` if it is missing.
- ffmpeg and ffprobe (`brew install ffmpeg`). The recorder burns captions with
  `drawtext` when the build has it; Homebrew's default build does not include
  libfreetype, so the recorder then renders each caption as a transparent PNG
  and overlays it instead. Both look the same.
- Ports 3240, 3241 and 3242 free. The recorder never touches any other port.

## Usage

From the repository root:

```sh
pnpm exec tsx scripts/video/record.ts
```

It takes about five minutes and:

1. starts `pnpm demo` with `PORT=3240 WEBHOOK_PORT=3241 MCP_PORT=3242`,
   `VISITPROOF_DEMO_STORE_PATH=/private/tmp/vp-video-store` and
   `VISITPROOF_DEMO_DOTENV=0`, so it never reads `.env` and never disturbs a demo
   you already have running on the default ports;
2. visits every route once so `next dev` has compiled it before recording;
3. renders the title cards from `scenes.ts` into `cards/*.html` and records
   each app scene at 1920 x 1080 (the family scene runs in a 430 x 620 phone
   iframe, scaled up sharply by Chromium and centred on the app's dark
   background);
4. trims each clip, joins them, and burns the lower-third captions;
5. writes `out/manifest.json`, regenerates `voiceover.md` with timestamps from
   the same run, saves one frame from the middle of every scene in
   `tmp/frames/`, and stops every process it started.

It prints the final duration and exits non-zero if the cut runs over 175
seconds or the output is not H.264, yuv420p, 1920 x 1080, 30 fps, and silent.

| File | What it is |
| --- | --- |
| `out/visitproof-demo.mp4` | The captioned cut, no audio |
| `out/visitproof-demo-nocaptions.mp4` | The same cut without captions |
| `out/manifest.json` | Scene ids, start and end seconds, live or offline mode, notes |
| `voiceover.md` | The voiceover script with matching timestamps, and how to record and mux it |
| `cards/*.html` | The generated title cards |

`out/` and `tmp/` are git-ignored.

### Editing Scenes

Everything on screen lives in `scenes.ts`: each scene's duration, caption,
voiceover line, and for app scenes the role, start page, and the unhurried
`play(page)` interactions. Captions stay in sentence case and under 72
characters so they fit on one line; titles use Title Case; no copy may contain
an em dash or en dash. The recorder checks the dashes, the caption length, and
that each voiceover line fits about 2.3 words per second before it records.

While iterating you can keep a demo running yourself on port 3240 and pass
`--reuse-server` (the recorder then leaves it running, and its clock is not
shifted), and re-record only some
scenes with `--only=scheduler,ask` (other clips are reused from the previous
run). Always finish with a plain run so the final cut comes from a fresh store.

## Live Mode

By default the cut is offline: no Ring token. The Ring scene then runs 12
seconds after the problem card: the family's Ring account page (the page Ring
opens after linking), then a click on Run Device Check, which shows its "Live
Mode Is Off" state because Device Check needs a Ring token. The caption frames
it as the linking step. The ten seconds this saves go to the scheduler scene
(40 seconds). The architecture card runs 10 seconds and highlights the Ring
Partner API, AWS, and Quality columns in turn.

For the live cut, mint a 30 minute token in the Ring Developer Playground and
export it in the shell for that run only:

```sh
export RING_PLAYGROUND_ACCESS_TOKEN='paste-the-token-here'
pnpm exec tsx scripts/video/record.ts
unset RING_PLAYGROUND_ACCESS_TOKEN
```

The recorder passes the variable straight through to `pnpm demo` (it still
does not read `.env`). The Ring scene then runs 22 seconds after the problem
card: Sync Ring History and its result, then Live View over WHEP with the
countdown running before Stop (Live View is opened once before the camera
rolls, so the route change does not flash a loading skeleton). The scheduler
scene runs 30 seconds. Both cuts run 168 seconds. If the console still
reports Live Mode Is Off, the recorder falls back to the offline cut and says
so in `out/manifest.json`. Start the run soon after minting, because the token
expires after 30 minutes.

## Simulated Clock

The demo replays today's visits until every one has settled, which runs past
the wall clock. So that every "now" on screen comes after those visits (a
caregiver note's stamp, the evidence pack's generated time), the offline run
starts the demo with `NODE_OPTIONS=--require=scripts/video/clock-shift.cjs`,
which moves the clock of every demo process to 9:50 PM ET today, and shifts
each recording page's clock by the same amount. Only the recorder's own demo
on ports 3240 to 3242 is affected. Live mode keeps the wall clock, because the
Ring token and history depend on it. `out/manifest.json` records which clock
the cut used.

## Voiceover

Follow `voiceover.md`: record `voiceover.m4a` in QuickTime or Voice Memos in a
quiet room about 30 cm from the microphone, then run the ffmpeg command there
to produce `out/visitproof-demo-final.mp4` (speech normalised to -16 LUFS).

## YouTube Upload Checklist

- [ ] Upload `out/visitproof-demo-final.mp4` (with the voiceover), not the silent cut.
- [ ] Visibility: **Public** (Devpost judges must be able to watch it without signing in).
- [ ] Audience: **No, it is not made for kids**.
- [ ] Title: `VisitProof: Proof Of Presence For Home Care From The Ring Doorbell`
- [ ] Description, for example:

  ```text
  VisitProof proves a home care visit happened, using the Ring doorbell the family already has.
  It shows that a person arrived at the door. It never identifies who.

  Built for the Amazon developer hackathon: Ring Partner API, AWS (Lambda, API Gateway,
  DynamoDB Streams, EventBridge, S3, KMS, SES, Bedrock Nova 2 Lite, CDK), and an MCP server
  for Alexa+. Open source under Apache-2.0.

  Code: https://github.com/CodeWithEugene/Amazon-Developer-Hackathon
  ```

- [ ] No music, or only music you have the rights to. The silent cut has none,
      and YouTube's Content ID will flag copyrighted tracks.
- [ ] Check the length is under three minutes on the YouTube page, then paste
      the link into the Devpost submission.
