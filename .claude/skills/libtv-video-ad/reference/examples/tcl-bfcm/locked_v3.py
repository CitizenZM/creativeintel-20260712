"""Locked v3 storyboards (approved 2026-10-04). Prompts are the raw KF/MO; the executor appends the realism
suffix and sends the model-specific negatives. Local stills are filled in with uploaded URLs at import time."""

def fr(n, t0, t1, seg, engine, kf="", mo="", refs="none", txt="", vo="", speed=None, zoom=None, compare=None, local=None, cast=None, fine=None):
    L = {"engine": engine, "refs": refs}
    if speed: L["speed"] = speed
    if zoom: L["zoomHit"] = {"x": zoom[0], "y": zoom[1]}
    if compare: L["compare"] = {"other": compare[0], "labelOurs": compare[1], "labelOther": compare[2]}
    if local: L["localImage"] = local
    if cast: L["castLock"] = cast
    if fine: L["fine"] = fine
    return {"frameNumber": n, "startSec": t0, "endSec": t1, "duration": f"{t1-t0:.1f}s", "segment": seg, "scene": "", "visualDirection": "",
            "voiceover": vo, "textOverlay": txt, "cameraNotes": "", "imagePrompt": kf, "videoPrompt": mo, "shotType": "", "cameraMove": "",
            "subject": "", "productAction": "", "sfx": "", "sellingPoint": "", "howExpressed": "", "locked": L}

TV_FINE = ("*Free standard professional installation added at checkout with an eligible TV purchased on TCL.com, by TCL's authorized "
           "third-party partner. Standard wall-mounting labor included; mount hardware and non-standard work extra. Availability varies "
           "by location. Installation sped up for dramatization. Comparisons simulated. #1 in TVs by TCL.com best-selling ranking, Oct 2026.")
TV8_FINE = TV_FINE.replace(" #1 in TVs by TCL.com best-selling ranking, Oct 2026.", "")
NXT_FINE = "Comparison simulated. Screen content for illustration."

QM7L_CAST = "A Latino man in his late 30s, medium build, short dark wavy hair, neatly trimmed beard, warm brown skin with faint smile lines, wearing a forest-green knit holiday sweater over a white tee and dark jeans."
QM8L_CAST = "An East Asian woman in her early 40s, slim build, chin-length black bob with a few grey strands, light freckles across the nose, wearing an oatmeal linen shirt with rolled sleeves, a thin gold ring and small pearl studs."
NXT_CAST = "A Black woman in her early 20s, slender build, natural curly hair tied up with loose curls framing her face, deep brown skin with a small mole above her lip, wearing a rust-brown cable-knit cardigan over a cream tee and small silver hoop earrings."

QM7L = [
 fr(1,0.0,1.0,"HOOK","kling", cast=QM7L_CAST, txt="BLACK FRIDAY", vo="This Black Friday,",
    kf="Medium-wide shot from inside the hallway, low angle, 24mm. The front door swings open onto a snowy porch at dusk; two installers in red knit beanies and navy work jackets, faces turned away, carry a huge flat TV-shaped gift wrapped in glossy red paper with an oversized gold satin bow. A six-year-old girl in plaid pajamas, seen from behind, throws both arms up in the foreground. Snow blows in, warm porch light, wet boot prints on a scuffed doormat.",
    mo="A fast whip from the staircase lands on the doorway, then a quick push-in. 0–0.5s: the installers tilt the gift through the frame as snow swirls in. 0.5–1s: the bow ribbons flutter and the girl jumps up and down; ends mid-jump."),
 fr(2,1.0,2.0,"HOOK","veo", speed=4, txt="FREE INSTALLATION INCLUDED*", vo="the surprise comes installed.",
    kf="Medium shot, eye level, 35mm. In a living room with a lit Christmas tree, two installers in red beanies, seen from behind, lift the large red gift-wrapped flat TV with a gold bow onto a black wall bracket; one holds a cordless drill. Plaid throw on a beige sofa, stockings on the fireplace, low winter sun from a side window.",
    mo="A smooth 30-degree arc around the wall. 0–1s: the drill spins a screw into the bracket. 1–3s: both installers lift the wrapped TV and hook it on with a firm push. 3–4s: they step back and brush off their gloves. Clear, deliberate actions at natural speed."),
 fr(3,2.0,3.0,"HOOK","kling", txt="SURPRISE — TCL HOLIDAY FREE INSTALLATION INCLUDED*",
    kf="Medium close-up, low angle, 35mm. A nine-year-old boy in plaid pajamas, seen in profile, grips a strip of red gift paper on a wall-mounted TV and is tearing it away; a bright snowy-village picture already glows through the tear and the gold bow is tumbling toward the lens. Christmas-tree lights soft behind him, torn paper edges catching warm light.",
    mo="A quick push-in. 0–0.6s: the boy rips the paper down in one big pull, it flutters away and the bow tumbles toward camera. 0.6–1s: the glowing picture fills the screen and he steps back in awe; ends mid-step."),
 fr(4,3.0,4.5,"BODY","veo1080", refs="product", zoom=(0.5,0.3), txt="3,000 NITS", vo="Three thousand nits beats the glare,",
    compare=("Medium shot, slightly off-axis, 35mm. The same living room with low winter sun from a large window falling directly across an older, thicker generic TV with a wide black bezel; its picture looks washed out, grey and low-contrast under the direct sun. Christmas tree on the right, plaid throw on the sofa arm.", "QM7L", "OLD TV"),
    kf="Medium shot, slightly off-axis, 35mm. Low winter sun from a large window falls directly across a wall-mounted TV showing a snowy village at dusk; the picture stays vivid with crisp bright windows. A Christmas tree on the right, plaid throw on the sofa arm in the foreground, dust motes in the beam.",
    mo="A slow pull-out from the screen. 0–1.5s: a sheer curtain sways and sunlight slides across the screen while the village lights twinkle and snow falls in the picture; ends mid-pull."),
 fr(5,4.5,6.0,"BODY","veo1080", refs="product", zoom=(0.62,0.42), txt="DOLBY VISION IQ",
    kf="Extreme close-up on a wall-mounted TV screen, 85mm. The picture shows a snowy village street at night: warm lit windows, falling snowflakes, frost on an iron lamppost; rich detail in both the bright windows and the dark blue snow shadows. A sliver of the thin metal frame at the edge of frame.",
    mo="A slow push toward the lit windows. 0–1.5s: snowflakes drift across the picture and a window light flickers warmly; ends mid-push."),
 fr(6,6.0,7.5,"BODY","kling", refs="cast", txt="144HZ GAMING", vo="smooth one-forty-four for the kids,",
    kf="Medium-wide shot, low angle, 28mm. Christmas morning: the same Latino man in a forest-green knit sweater sits between his two kids in plaid pajamas on a beige sofa, all three leaning hard to one side with game controllers while a kart race streaks across the wall-mounted TV. Torn wrapping paper on the rug, tree lights glowing, a mug of cocoa on the side table.",
    mo="Handheld follow that leans with them. 0–1s: all three lean into the bend, the girl squeals and bumps her dad's shoulder. 1–1.5s: they swing the other way and the dad laughs; ends mid-lean."),
 fr(7,7.5,9.0,"BODY","kling", refs="cast", txt="DOLBY ATMOS", vo="game-day roar with Dolby Atmos,",
    kf="Wide shot, low angle, 24mm. Game day in the same living room: the man in the green sweater and three friends leap up from the sofa cheering a touchdown on the wall-mounted TV (plain uniforms, no logos); a bowl of popcorn flips in the air. Afternoon window light, holiday garland on the mantel.",
    mo="A crane down into a push-in. 0–1s: everyone jumps with arms up as popcorn sprays. 1–1.5s: two friends high-five; ends mid-high-five."),
 fr(8,9.0,10.5,"BODY","veo1080", refs="none", zoom=(0.40,0.28), txt="2,100+ ZONES", vo="and true black at midnight.",
    kf="Wide shot from behind the sofa, 35mm. New Year's Eve: the family in silhouette, kids in paper party hats, watches gold and magenta fireworks burst over a city skyline on the wall-mounted TV, deep true-black sky around them. Tree lights and a table lamp keep the room warmly readable; confetti on the sofa back.",
    mo="A slow arc from left to right. 0–1.5s: fireworks bloom on screen, the kids throw up their arms for the countdown, confetti drifts down; ends mid-arc."),
 fr(9,10.5,12.0,"BODY","veo", refs="cast", txt="#1 BEST SELLER IN CATEGORY*",
    kf="Medium-wide shot, eye level, 28mm. The same Latino man in a green sweater hugs his two kids on the sofa, clinking mugs of cocoa, while the wall-mounted TV glows with a snowy village beside the Christmas tree. Warm tree lights, plaid throw, torn wrapping paper still on the rug.",
    mo="A slow crane up and pull-out. 0–1s: the mugs clink and the kids snuggle in. 1–1.5s: the camera rises to reveal the whole festive wall; ends while still rising."),
 fr(10,12.0,13.5,"CTA","local", local="END_QM7L_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="QM7L — installed free. Shop TCL.com.", fine=TV_FINE),
 fr(11,13.5,15.0,"CTA","local", local="END_QM7L_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="QM7L — installed free. Shop TCL.com.", fine=TV_FINE),
]

QM8L = [
 fr(1,0.0,1.0,"HOOK","veo", cast=QM8L_CAST, txt="BLACK FRIDAY", vo="Black Friday:",
    kf="Medium-wide shot from inside a city loft, 24mm. The door opens; two installers in charcoal work jackets and knit beanies, faces turned away, stride in carrying a very large, remarkably thin flat-screen TV, screen facing them. Light snow outside, concrete floor, white plaster wall with a framed print, cool daylight.",
    mo="A whip from the window lands on the door, then a handheld follow moving backward. 0–1s: the installers carry the thin panel in as snowflakes swirl at the threshold; ends mid-stride."),
 fr(2,1.0,2.0,"HOOK","veo", speed=4, txt="FREE INSTALLATION INCLUDED*", vo="the TV that hangs like art.",
    kf="Medium shot, eye level, 35mm. Two installers in charcoal jackets, seen from behind, lift a large ultra-thin TV onto a wall bracket between two framed prints on a white plaster wall, like hanging a painting. Concrete floor, walnut credenza, bright window light from the left.",
    mo="A smooth 40-degree orbit. 0–2s: they raise the thin TV level with the prints. 2–3s: they hook it on with a firm press. 3–4s: one checks it with a small level and both step back. Clear, deliberate actions at natural speed."),
 fr(3,2.0,3.0,"HOOK","veo1080", refs="product", zoom=(0.55,0.5), txt='2.0" SLIM',
    kf="Side-profile close shot along a white plaster wall at TV height, 50mm. A very thin wall-mounted TV sits almost flush with the wall, its slim metal edge catching a line of window light, screen glow spilling onto the plaster. Plaster texture and a faint shadow line behind the panel.",
    mo="A slow lateral track along the wall toward the TV's edge. 0–1s: the light line slides along the metal edge as the camera moves; ends mid-track."),
 fr(4,3.0,4.5,"BODY","veo1080", refs="product", zoom=(0.9,0.12), txt="ZEROBORDER", vo="No border. No glare.",
    compare=("Close shot of a white plaster wall with an older, thick generic TV with a wide glossy black bezel; its picture is dull and washed out with a visible window reflection. Same framing and soft window light.", "QM8L", "OLD TV"),
    kf="Close shot of a wall-mounted TV's top corner, 50mm. An abstract color-field painting in deep ultramarine and terracotta runs right to the edge of the screen; the frame is a hair-thin metal line against white plaster. Soft window light, no reflections.",
    mo="A slow push toward the corner. 0–1.5s: the painting drifts slowly as it pans and the thin edge glints; ends mid-push."),
 fr(5,4.5,6.0,"BODY","veo1080", refs="product", zoom=(0.3,0.18), txt="6,000 NITS", vo="Six thousand nits at noon,",
    kf="Wide shot, eye level, 28mm. Noon sun pours through floor-to-ceiling windows directly onto a wall-mounted TV showing a football game under bright stadium floodlights (plain uniforms, no logos); the picture stays punchy. Window-mullion shadows stripe the concrete floor, snacks on the walnut credenza, dust in the light.",
    mo="A steady pull-out from the screen. 0–1.5s: the mullion shadows slide across the floor as the camera glides back, players sprint on screen; ends mid-pull."),
 fr(6,6.0,7.5,"BODY","kling", refs="cast", txt="4K 144HZ",
    kf="Medium-wide shot, low angle, 24mm. In the sunlit loft the same East Asian woman with a black bob and three friends jump up from a low sofa cheering a touchdown on the wall-mounted TV; two friends mid high-five. Hard noon light, linen and denim creases, a snack bowl tipping.",
    mo="Handheld follow. 0–1s: everyone leaps up with arms raised and the bowl tips. 1–1.5s: the high-five lands and they burst out laughing; ends mid-celebration."),
 fr(7,7.5,9.0,"BODY","veo", refs="cast", txt="SOUND BY B&O", vo="sound by Bang & Olufsen,",
    kf="Medium shot, eye level, 35mm. Evening in the loft: a man in a dark wool sweater, in profile, lights candles on the walnut credenza beneath the wall-mounted TV showing a crackling fireplace, while the same East Asian woman in an oatmeal linen shirt walks in with two glasses of red wine. City lights and light snow beyond the windows, warm candle glow on their faces.",
    mo="A slow arc from right to left. 0–1s: the match flares and the candle catches as she steps in with the glasses. 1–1.5s: he turns and reaches for a glass; ends mid-reach."),
 fr(8,9.0,10.5,"BODY","veo1080", refs="none", zoom=(0.5,0.3), txt="4,000+ ZONES", vo="and true black by candlelight.",
    kf="Wide shot, low angle, 35mm. Candles and a floor lamp warm the loft while the wall-mounted TV shows a bright full moon over a desert star field with deep true-black sky; a couple sits close on a boucle loveseat, faces and furniture readable. Snow drifting past dark windows.",
    mo="A slow push toward the screen. 0–1.5s: candle flames flicker, she rests her head on his shoulder, stars glint on screen; ends mid-push."),
 fr(9,10.5,12.0,"BODY","veo", refs="cast", txt="INSTALLED FREE*",
    kf="Medium-wide shot, eye level, 28mm. The same East Asian woman with a black bob and her partner clink wine glasses on a loveseat; behind them the borderless TV, showing an abstract color-field painting, hangs between two framed prints like part of a gallery wall. Candlelight, city lights through tall windows, a throw over the armrest.",
    mo="A gentle crane up. 0–1s: the glasses clink and she laughs. 1–1.5s: the camera rises to reveal the gallery wall; ends while still rising."),
 fr(10,12.0,13.5,"CTA","local", local="END_QM8L_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Installed free. Shop TCL.com.", fine=TV8_FINE),
 fr(11,13.5,15.0,"CTA","local", local="END_QM8L_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Installed free. Shop TCL.com.", fine=TV8_FINE),
]

NXT = [
 fr(1,0.0,1.0,"HOOK","kling", refs="cast", cast=NXT_CAST, txt="STILL USING PAPER?", vo="Pages flying again?",
    kf="Medium shot, eye level, 35mm. A gust throws open the window beside a worn upright piano; printed sheet music and a few snowflakes swirl off the music stand as the same young Black woman with tied-up curls in a rust cable-knit cardigan reaches up to catch them mid-motion. A small Christmas tree in the corner, cold daylight, pencil and metronome on the lid.",
    mo="A whip that lands on the piano, then a fast push-in. 0–1s: pages and snowflakes spin through the air, she lunges and catches one, curls bouncing; ends mid-catch."),
 fr(2,1.0,2.0,"HOOK","veo", refs="product", txt="NXTPAPER 14", vo="Next Paper Fourteen",
    kf="Medium close-up, eye level, 50mm. Hands set a large slim grey tablet showing a full page of sheet music on the music stand of an upright piano; snowy daylight from the window falls straight across its matte screen with no glare spot. Worn ivory keys in the foreground, loose-knit cardigan sleeve.",
    mo="A steady push-in. 0–1s: the hands let go, the tablet settles against the stand and window light sweeps across the matte surface; ends mid-push."),
 fr(3,2.0,3.5,"HOOK","local", local="NXT_S3_matte.jpg", zoom=(0.5,0.45), txt="NO GLARE", vo="shows the whole page — no glare.",
    compare=("Medium close-up, eye level, 50mm. A generic glossy black tablet showing sheet music on a piano music stand; a bright white window reflection washes out the middle of the screen. Snowy daylight, worn ivory keys in the foreground.", "NXTPAPER 14", "GLOSSY TABLET")),
 fr(4,3.5,5.0,"BODY","local", local="NXT_S4_a4.jpg", zoom=(0.5,0.4), txt='FULL A4 PAGE · 14.3"'),
 fr(5,5.0,6.5,"BODY","kling", refs="cast+product", txt="T-PEN PAGE TURN", vo="Tap to turn the page,",
    kf="Close-up from the side, 35mm. The same young Black woman in a rust cardigan plays the upright piano, fingers mid-chord on worn ivory keys, as her right hand lifts a slim stylus toward the tablet on the music stand. Snow outside the window, small silver hoop catching the light, tree-light bokeh behind.",
    mo="A smooth track to the left along the keyboard. 0–1s: her fingers run a quick phrase. 1–1.5s: she taps the tablet with the stylus to turn the page and drops back onto the keys; ends mid-phrase."),
 fr(6,6.5,7.5,"BODY","veo1080", refs="product", zoom=(0.15,0.5), txt="ONE KEY", vo="one key for ink paper,",
    kf="Extreme close-up, 85mm. A thumb presses a small physical key on the edge of a slim grey tablet resting on a piano music stand; a strip of sheet music on the matte screen and the cardigan cuff are visible. Warm side light, fine dust on the stand.",
    mo="A slow push-in. 0–1s: the thumb presses the key firmly and releases; ends on the release."),
 fr(7,7.5,8.5,"BODY","local", local="NXT_S7_ink.jpg", txt="INK PAPER MODE"),
 fr(8,8.5,10.0,"BODY","veo", refs="cast+product", txt="EASY ON THE EYES", vo="and practice for hours.",
    kf="Medium shot, eye level, 35mm. Evening at the same upright piano: a warm brass desk lamp lights the same young Black woman in a rust cardigan as she rolls her shoulders mid-stretch, the tablet on the stand showing soft grey ink-paper sheet music. Deep blue window with falling snow, tree lights in the corner.",
    mo="A slow arc. 0–1s: she stretches and smiles at the page. 1–1.5s: she places her hands back on the keys and starts playing; ends mid-phrase."),
 fr(9,10.0,11.0,"BODY","veo", refs="product", txt="GIFT IT",
    kf="Top-down shot, 35mm. On a wooden table under a small Christmas tree, hands pull a red ribbon off a plain kraft-paper gift box with no printing; the lid lifts to reveal a slim grey tablet. Wrapping scraps, a spool of ribbon, pine needles, warm window light.",
    mo="A slow crane down. 0–1s: the ribbon slides loose and the lid lifts; ends mid-lift."),
 fr(10,11.0,12.0,"BODY","veo", refs="cast", txt="NOTHING TO SET UP", vo="Nothing to set up — just play.",
    kf="Medium shot, eye level, 35mm. The same young Black woman in a rust cardigan leans over her ten-year-old brother, seen in profile, at the upright piano and sets the tablet with sheet music on the stand. Snowy afternoon light, his small hands hovering over worn keys, her hand on his shoulder, tree lights behind.",
    mo="A handheld follow that leans in. 0–1s: she slides the tablet onto the stand and points at the first note; he presses a key and both laugh; ends mid-laugh."),
 fr(11,12.0,13.5,"CTA","local", local="END_NXT_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Black Friday at TCL.com.", fine=NXT_FINE),
 fr(12,13.5,15.0,"CTA","local", local="END_NXT_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Black Friday at TCL.com.", fine=NXT_FINE),
]

ADS = {
 "QM7L-A": {"project": {"name": "TCL QM7L — Black Friday · Unwrap the Holidays", "brandName": "TCL", "productName": "QM7L Series SQD-Mini LED 4K TV", "productUrl": "https://us.tcl.com/products/qm7l-series-sqd-mini-led-4k-uhd-hdr-smart-tv-with-google-tv"}, "ref": "REF_QM7L.jpg", "frames": QM7L},
 "QM8L-A": {"project": {"name": "TCL QM8L — Black Friday · Hangs Like Art", "brandName": "TCL", "productName": "QM8L Series SQD-Mini LED 4K TV", "productUrl": "https://us.tcl.com/products/qm8l-series-sqd-mini-led-4k-uhd-hdr-smart-tv-with-google-tv"}, "ref": "REF_QM8L.jpg", "frames": QM8L},
 "NXT-A":  {"project": {"name": "TCL NXTPAPER 14 — Black Friday · Full Page, No Glare", "brandName": "TCL", "productName": "NXTPAPER 14", "productUrl": "https://us.tcl.com/products/nxtpaper-14"}, "ref": "REF_NXT.jpg", "frames": NXT},
}

if __name__ == "__main__":
    for k, a in ADS.items():
        fs = a["frames"]; gen = [f for f in fs if f["locked"]["engine"] != "local"]
        assert all(f["endSec"] - f["startSec"] <= 2.0 for f in fs), k
        assert abs(fs[-1]["endSec"] - 15.0) < 1e-6, k
        print(k, len(fs), "frames,", len(gen), "generated,", sum(1 for f in gen if f["locked"]["engine"] == "kling"), "Kling,",
              sum(1 for f in fs if f["locked"].get("compare")), "compare,", sum(1 for f in fs if f["locked"].get("zoomHit")), "zoom hits")
