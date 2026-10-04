"""Locked v4 storyboards (2026-10-04, Barron's notes on v3 keyframes):
- cast: white or Latino families only; one family/couple casting sheet per ad so every shot reuses the same faces
- QM8L art mode = Van Gogh's Sunflowers (public domain), framed in a cream mat like a painting
- QM7L: every TV shot edits from the straight-front QM7L_01 render (real ultra-narrow bezel), with that shot's picture on screen
- NXTPAPER 14: top-down gift unboxing, 360° turntable reveal, sheet music → hand sketch switch
`ref` / `local` are composite filenames, swapped for uploaded URLs (refImageUrl / localImageUrl) at import."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from locked_v3 import TV_FINE, TV8_FINE, NXT_FINE

def fr(n, t0, t1, seg, engine, kf="", mo="", refs="none", txt="", vo="", speed=None, zoom=None, compare=None, local=None, ref=None, cast=None, fine=None):
    L = {"engine": engine, "refs": refs}
    if speed: L["speed"] = speed
    if zoom: L["zoomHit"] = {"x": zoom[0], "y": zoom[1]}
    if compare: L["compare"] = {"other": compare[0], "labelOurs": compare[1], "labelOther": compare[2]}
    if local: L["localImage"] = local
    if ref: L["refImage"] = ref
    if cast: L["castLock"] = cast
    if fine: L["fine"] = fine
    return {"frameNumber": n, "startSec": t0, "endSec": t1, "duration": f"{t1-t0:.1f}s", "segment": seg, "scene": "", "visualDirection": "",
            "voiceover": vo, "textOverlay": txt, "cameraNotes": "", "imagePrompt": kf, "videoPrompt": mo, "shotType": "", "cameraMove": "",
            "subject": "", "productAction": "", "sfx": "", "sellingPoint": "", "howExpressed": "", "locked": L}

BEZEL7 = "The TV is the exact model from image 2: an ultra-narrow, nearly borderless frame — a razor-thin matte-black line of equal thinness on all four sides, never a thick border."
BEZEL8 = "The TV is the exact model from image 2: a hair-thin metal edge on all four sides, almost flush with the wall — no wooden, decorative or thick frame."

QM7L_CAST = ("A Latino family of three standing close together: the father, late 30s, medium build, short dark wavy hair, neatly trimmed beard, warm olive-brown skin, "
             "wearing a forest-green knit holiday sweater over a white tee and dark jeans; his daughter, about 6, long dark-brown curls with a small red velvet bow, "
             "red-and-green plaid flannel pajamas; his son, about 9, short dark hair, light-brown skin, gap-toothed grin, matching plaid pajamas.")
QM8L_CAST = ("A couple standing side by side: a white woman in her early 40s, slim build, chin-length auburn bob, light freckles across the nose, green eyes, "
             "wearing an oatmeal linen shirt with rolled sleeves, a thin gold ring and small pearl studs; and her partner, a white man in his early 40s, "
             "short sandy-brown hair with a little grey at the temples, light stubble, fair skin, blue eyes, wearing a charcoal wool crewneck sweater.")
NXT_CAST = ("A young Latina woman in her early 20s, slender, long dark-brown wavy hair in a loose half-up clip, fair light-tan skin, hazel eyes, a small beauty mark above her lip, "
            "wearing a rust-brown cable-knit cardigan over a cream tee and small silver hoop earrings; beside her, her younger brother, about 10, Latino, "
            "short dark-brown hair, fair light-tan skin, light freckles, round cheeks, navy hoodie.")
DOG7 = "Their golden retriever lies on the rug at their feet, head up, tail wagging."
DOG8 = "Their fawn French bulldog lies on a round wool rug nearby."
INSTALLERS = "two white male installers in red knit beanies and navy work jackets, faces turned away from the camera"

QM7L = [
 fr(1,0.0,1.0,"HOOK","kling", cast=QM7L_CAST, txt="BLACK FRIDAY", vo="This Black Friday,",
    kf=f"Medium-wide shot from inside the hallway, low angle, 24mm. The front door swings open onto a snowy porch at dusk; {INSTALLERS}, carry a huge flat TV-shaped gift wrapped in glossy red paper with an oversized gold satin bow. In the foreground a six-year-old Latina girl with long dark-brown curls and a small red velvet bow, in red-and-green plaid pajamas, seen from behind, throws both arms up. Snow blows in, warm porch light, wet boot prints on a scuffed doormat.",
    mo="A fast whip from the staircase lands on the doorway, then a quick push-in. 0–0.5s: the installers tilt the gift through the frame as snow swirls in. 0.5–1s: the bow ribbons flutter and the girl jumps up and down; ends mid-jump."),
 fr(2,1.0,2.0,"HOOK","veo", speed=4, txt="FREE INSTALLATION INCLUDED*", vo="the surprise comes installed.",
    kf=f"Medium shot, eye level, 35mm. In a living room with a lit Christmas tree, {INSTALLERS}, lift the large red gift-wrapped flat TV with a gold bow onto a black wall bracket; one holds a cordless drill. Plaid throw on a beige sofa, stockings on the fireplace, low winter sun from a side window.",
    mo="A smooth 30-degree arc around the wall. 0–1s: the drill spins a screw into the bracket. 1–3s: both installers lift the wrapped TV and hook it on with a firm push. 3–4s: they step back and brush off their gloves. Clear, deliberate actions at natural speed."),
 fr(3,2.0,3.0,"HOOK","kling", refs="cast", ref="REF_QM7L_village.jpg", txt="SURPRISE — TCL HOLIDAY FREE INSTALLATION INCLUDED*",
    kf=f"Medium close-up, low angle, 35mm. Only the boy from image 1 is in this shot: in profile, in his plaid pajamas, he grips a strip of red gift paper on the wall-mounted TV and tears it away; the snowy-village picture from image 2 glows through the tear and a gold bow tumbles toward the lens. {BEZEL7} Christmas-tree lights soft behind him, torn paper edges catching warm light.",
    mo="A quick push-in. 0–0.6s: the boy rips the paper down in one big pull, it flutters away and the bow tumbles toward camera. 0.6–1s: the glowing picture fills the screen and he steps back in awe; ends mid-step."),
 fr(4,3.0,4.5,"BODY","veo1080", refs="product", ref="REF_QM7L_village.jpg", zoom=(0.5,0.3), txt="3,000 NITS", vo="Three thousand nits beats the glare,",
    compare=("Medium shot, slightly off-axis, 35mm. The same living room with low winter sun from a large window falling directly across an older, thicker generic TV with a wide black bezel; its picture looks washed out, grey and low-contrast under the direct sun. Christmas tree on the right, plaid throw on the sofa arm.", "QM7L", "OLD TV"),
    kf=f"Medium shot, slightly off-axis, 35mm. Low winter sun from a large window falls directly across the wall-mounted TV showing the snowy village at dusk from image 1; the picture stays vivid with crisp bright windows. The TV keeps its ultra-narrow, nearly borderless frame of equal thinness on all four sides. A Christmas tree on the right, plaid throw on the sofa arm in the foreground, dust motes in the beam.",
    mo="A slow pull-out from the screen. 0–1.5s: a sheer curtain sways and sunlight slides across the screen while the village lights twinkle and snow falls in the picture; ends mid-pull."),
 fr(5,4.5,6.0,"BODY","veo1080", refs="product", ref="REF_QM7L_village.jpg", zoom=(0.62,0.42), txt="DOLBY VISION IQ",
    kf="Extreme close-up on the lower-right part of the wall-mounted TV from image 1, 85mm: the snowy village street at night fills the frame — warm lit windows, falling snowflakes, frost on an iron lamppost, rich detail in both the bright windows and the dark blue snow shadows — and a sliver of the TV's razor-thin matte-black edge runs along the right side of the frame.",
    mo="A slow push toward the lit windows. 0–1.5s: snowflakes drift across the picture and a window light flickers warmly; ends mid-push."),
 fr(6,6.0,7.5,"BODY","kling", refs="cast", ref="REF_QM7L_kart.jpg", txt="144HZ GAMING", vo="smooth one-forty-four for the kids,",
    kf=f"Medium-wide shot, low angle, 28mm. Christmas morning: the father and both children from image 1, same faces and outfits, sit close together on a beige sofa with game controllers while the kart race from image 2 streaks across the wall-mounted TV; the girl turns to her dad laughing and saying something, he grins back at her, the boy leans into the turn. {DOG7} {BEZEL7} Torn wrapping paper on the rug, tree lights glowing, a mug of cocoa on the side table. Relaxed, natural body language.",
    mo="Handheld follow that leans with them. 0–1s: all three lean into the bend, the girl bumps her dad's shoulder and they share a laughing look. 1–1.5s: the boy says something and the dad laughs while the dog's tail thumps on the rug; ends mid-lean."),
 fr(7,7.5,9.0,"BODY","kling", refs="cast", ref="REF_QM7L_football.jpg", txt="DOLBY ATMOS", vo="Dolby Atmos for game day,",
    kf=f"Medium-wide shot, low angle, 28mm. Game day in the same living room, decorated with red and gold Christmas balloons. Only the father from image 1 (not the children), same face, beard and forest-green sweater, stands up in the sharp foreground with a fist raised, turning to his friend and shouting with joy at a touchdown on the wall-mounted TV showing the football game from image 2; behind him, slightly soft, two friends — a white man in a grey hoodie and a Latina woman in a denim shirt — cheer and look at each other, a few Christmas balloons bobbing around them. {DOG7} {BEZEL7} Afternoon window light, holiday garland on the mantel. Natural, unposed reactions.",
    mo="A crane down into a push-in. 0–1s: he jumps up and turns to his friend as the Christmas balloons bounce around them. 1–1.5s: they high-five and laugh while the dog hops up on the rug; ends mid-high-five."),
 fr(8,9.0,10.5,"BODY","veo1080", refs="product", ref="REF_QM7L_fireworks.jpg", zoom=(0.40,0.28), txt="2,100+ ZONES", vo="and true black at midnight.",
    kf="Wide shot from behind the sofa, 35mm. New Year's Eve: a father and two kids in paper party hats, in silhouette from behind, watch the gold and magenta fireworks from image 1 burst over a city skyline on the wall-mounted TV, deep true-black sky on screen; the TV keeps its ultra-narrow frame. Tree lights and a table lamp keep the room warmly readable; confetti on the sofa back.",
    mo="A slow arc from left to right. 0–1.5s: fireworks bloom on screen, the kids throw up their arms for the countdown, confetti drifts down; ends mid-arc."),
 fr(9,10.5,12.0,"BODY","veo", refs="cast", ref="REF_QM7L_village.jpg", txt="#1 BEST SELLER IN CATEGORY*",
    kf=f"Medium-wide shot, eye level, 28mm. The father and both children from image 1, same faces and outfits, snuggle on the sofa with mugs of cocoa; the girl whispers something to her dad and the boy laughs at it, all three looking at each other, while the wall-mounted TV beside the Christmas tree glows with the snowy village from image 2. {DOG7} {BEZEL7} Warm tree lights, plaid throw, torn wrapping paper still on the rug.",
    mo="A slow crane up and pull-out. 0–1s: the girl whispers to her dad, he laughs and the mugs clink. 1–1.5s: the camera rises to reveal the whole festive wall; ends while still rising."),
 fr(10,12.0,13.5,"CTA","local", local="END_QM7L_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="QM7L — installed free. Shop TCL.com.", fine=TV_FINE),
 fr(11,13.5,15.0,"CTA","local", local="END_QM7L_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="QM7L — installed free. Shop TCL.com.", fine=TV_FINE),
]

SUN = "Van Gogh's Sunflowers filling the whole screen edge to edge — full-screen, no mat, no inner border — exactly as on the screen in image 2 — a wide landscape 65-inch TV whose picture is the painting, with only a hair-thin metal edge and no wooden, decorative or thick frame"
QM8L = [
 fr(1,0.0,1.0,"HOOK","veo", cast=QM8L_CAST, txt="BLACK FRIDAY", vo="Black Friday:",
    kf="Medium-wide shot from inside a city loft, 24mm. The door opens; two white male installers in charcoal work jackets and knit beanies, faces turned away from the camera, stride in carrying a very large, remarkably thin flat-screen TV, screen facing them. Light snow outside, concrete floor, white plaster wall with two framed prints, cool daylight.",
    mo="A whip from the window lands on the door, then a handheld follow moving backward. 0–1s: the installers carry the thin panel in as snowflakes swirl at the threshold; ends mid-stride."),
 fr(2,1.0,2.0,"HOOK","veo", refs="product", ref="REF_QM8L_sun.jpg", speed=4, txt="FREE INSTALLATION INCLUDED*", vo="the TV that hangs like art.",
    kf=f"Medium shot, eye level, 35mm. Two white male installers with fair skin, in charcoal jackets and knit beanies, backs fully to the camera, lift the ultra-thin TV from image 1 onto a wall bracket between two framed prints on a white plaster wall; its screen already shows {SUN.replace('image 2', 'image 1')}. Concrete floor, walnut credenza, bright window light from the left.",
    mo="A smooth 40-degree orbit. 0–2s: they raise the thin TV level with the prints. 2–3s: they hook it on with a firm press. 3–4s: one checks it with a small level and both step back. Clear, deliberate actions at natural speed."),
 fr(3,2.0,3.0,"HOOK","veo1080", refs="product", ref="REF_QM8L_sun.jpg", zoom=(0.55,0.5), txt='2.0" SLIM',
    kf=f"Side-profile close shot along a white plaster wall at TV height, 50mm. The very thin, wide landscape wall-mounted TV from image 1 sits almost flush with the wall, its slim metal edge catching a line of window light; the warm yellow glow of the Sunflowers picture on its screen spills onto the plaster. {BEZEL8} Plaster texture and a faint shadow line behind the panel.",
    mo="A slow lateral track along the wall toward the TV's edge. 0–1s: the light line slides along the metal edge as the camera moves; ends mid-track."),
 fr(4,3.0,4.5,"BODY","veo1080", refs="product", ref="REF_QM8L_corner.jpg", zoom=(0.9,0.12), txt="ZEROBORDER", vo="No border. No glare.",
    compare=("Tight close-up of the top-right corner of an older, thick generic TV with a wide glossy black bezel on a smooth white plaster wall, 85mm; its picture is dull and washed out with a window reflection across the glass. No people. Soft window light.", "QM8L", "OLD TV"),
    kf="Tight close-up of only the top-right corner of the wall-mounted TV from image 1, 85mm: Van Gogh's Sunflowers — thick impasto yellow petals and the ochre background — runs right to the edge of the screen; the frame is a hair-thin metal line against white plaster — no thick border, no logo. Matte screen with no reflections, soft window light, plaster texture beside it.",
    mo="A slow push toward the corner. 0–1.5s: the light shifts softly across the painting's brushstrokes and the thin edge glints; ends mid-push."),
 fr(5,4.5,6.0,"BODY","veo1080", refs="product", ref="REF_QM8L_football.jpg", zoom=(0.3,0.18), txt="6,000 NITS", vo="Six thousand nits at noon,",
    kf=f"Wide shot, eye level, 28mm. Noon sun pours through floor-to-ceiling windows directly onto the wall-mounted TV from image 1 showing its football game under bright stadium floodlights; the picture stays punchy. {BEZEL8} Window-mullion shadows stripe the concrete floor, snacks on the walnut credenza, dust in the light.",
    mo="A steady pull-out from the screen. 0–1.5s: the mullion shadows slide across the floor as the camera glides back, players sprint on screen; ends mid-pull."),
 fr(6,6.0,7.5,"BODY","kling", refs="cast", ref="REF_QM8L_football.jpg", txt="4K 144HZ",
    kf=f"Medium-wide shot, low angle, 24mm. In the sunlit loft, decorated with red and gold Christmas balloons tied to the sofa arm, the couple from image 1, same faces and clothes, jump up from a low sofa with two friends — a white man in a flannel shirt and a Latina woman in a denim jacket — cheering a touchdown on the wall-mounted TV showing the football game from image 2; the woman and her partner turn to each other mid high-five, laughing. {DOG8} {BEZEL8} Hard noon light, linen and denim creases. Natural, unposed reactions.",
    mo="Handheld follow. 0–1s: everyone leaps up with arms raised and the Christmas balloons bob. 1–1.5s: the couple's high-five lands and they talk excitedly to each other; ends mid-celebration."),
 fr(7,7.5,9.0,"BODY","veo", refs="cast", ref="REF_QM8L_fireplace.jpg", txt="SOUND BY B&O", vo="sound by Bang & Olufsen,",
    kf=f"Medium shot, eye level, 35mm. Evening in the loft: the man from image 1 in his charcoal sweater, in profile, lights candles on the walnut credenza beneath the wall-mounted TV showing the crackling fireplace from image 2, while the woman from image 1 in her oatmeal linen shirt walks in with two glasses of red wine, smiling and saying something to him as he looks up at her. {DOG8} {BEZEL8} City lights and light snow beyond the windows, warm candle glow on their faces.",
    mo="A slow arc from right to left. 0–1s: the match flares and the candle catches as she steps in with the glasses. 1–1.5s: he turns and reaches for a glass; ends mid-reach."),
 fr(8,9.0,10.5,"BODY","veo1080", refs="product", ref="REF_QM8L_moon.jpg", zoom=(0.5,0.3), txt="4,000+ ZONES", vo="and true black by candlelight.",
    kf=f"Wide shot, low angle, 35mm. Candles and a floor lamp warm the loft while the wall-mounted TV from image 1 shows its bright full moon over a desert star field with deep true-black sky; a couple sits close on a boucle loveseat, seen from behind, furniture readable. {BEZEL8} Snow drifting past dark windows.",
    mo="A slow push toward the screen. 0–1.5s: candle flames flicker, she rests her head on his shoulder, stars glint on screen; ends mid-push."),
 fr(9,10.5,12.0,"BODY","veo", refs="cast", ref="REF_QM8L_sun.jpg", txt="FREE INSTALLATION INCLUDED*",
    kf=f"Medium-wide shot, eye level, 28mm. The couple from image 1, same faces and clothes, clink wine glasses on a loveseat, turned toward each other and laughing mid-conversation; {DOG8} behind them the borderless TV shows {SUN}, hanging between two framed prints like part of a gallery wall. Candlelight, city lights through tall windows, a throw over the armrest.",
    mo="A gentle crane up. 0–1s: he says something, she laughs and the glasses clink. 1–1.5s: the camera rises to reveal the gallery wall; ends while still rising."),
 fr(10,12.0,13.5,"CTA","local", local="END_QM8L_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Installed free. Shop TCL.com.", fine=TV8_FINE),
 fr(11,13.5,15.0,"CTA","local", local="END_QM8L_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Installed free. Shop TCL.com.", fine=TV8_FINE),
]

NXT = [
 fr(1,0.0,1.0,"HOOK","kling", cast=NXT_CAST, txt="BLACK FRIDAY", vo="Unwrap {NXTPAPER 14|Next Paper Fourteen} —",
    kf="Top-down overhead shot looking straight down, 35mm. On a worn oak coffee table, two hands in rust-brown cable-knit cardigan sleeves tear glossy red wrapping paper with a gold satin bow off a slim, flat rectangular gift box; torn paper curls, a spool of red ribbon, pine needles and a mug of cocoa in one corner, warm Christmas-tree light from one side.",
    mo="Overhead camera with a slow push down. 0–0.5s: both hands rip the red paper away in one pull and the bow flies out of frame. 0.5–1s: a plain matte-white box is revealed; ends as the fingers grip the lid."),
 fr(2,1.0,2.0,"HOOK","veo", refs="product", ref="REF_NXT_dark.jpg", txt="NXTPAPER 14", vo="",
    kf="Top-down overhead shot looking straight down, 35mm. The lid of a plain matte-white box with no printing has just been lifted away, revealing the slim dark-grey 14-inch tablet from image 1 lying in a fitted tray, screen dark, with a slim black stylus beside it; two hands in rust cardigan sleeves reach in. Red wrapping scraps, ribbon and pine needles around the box on the oak table.",
    mo="Slow overhead push-in. 0–1s: the lid slides out of frame. 1–3s: the hands lift the tablet out of the tray toward the camera. Natural speed."),
 fr(3,2.0,3.5,"HOOK","kling", refs="product", ref="REF_NXT.jpg", speed=3.3, txt="ULTRA-SLIM 6.95 MM",
    kf="Product hero shot, eye level, 50mm. The slim dark-grey tablet from image 1 stands upright on a small round walnut turntable on a wooden table by a frosted window, its matte screen showing the page of sheet music from image 1; warm Christmas-tree bokeh behind, a sprig of pine beside the turntable.",
    mo="The turntable makes one full, even 360-degree turn over 5 seconds: the front, the razor-thin side edge, the back with its round camera, the other edge and the front again, while the camera slowly pushes in. The tablet stays rigid and identical throughout; smooth, steady rotation."),
 fr(4,3.5,5.0,"BODY","local", local="NXT_S3_matte.jpg", zoom=(0.5,0.45), txt="NO GLARE", vo="a full page, no glare,",
    compare=("Medium close-up, eye level, 50mm. A generic glossy black tablet showing sheet music on a piano music stand; a bright white window reflection washes out the middle of the screen. Snowy daylight, worn ivory keys in the foreground.", "NXTPAPER 14", "GLOSSY TABLET")),
 fr(5,5.0,6.0,"BODY","local", local="NXT_S4_a4.jpg", zoom=(0.5,0.4), txt='FULL A4 PAGE · 14.3"'),
 fr(6,6.0,7.5,"BODY","kling", refs="cast", ref="REF_NXT.jpg", txt="T-PEN PAGE TURN", vo="tap to turn the page,",
    kf="Close-up from the side, 35mm. Only the young woman from image 1 (not her brother), same face, hair, skin tone and rust cardigan, plays an upright piano, fingers mid-chord on worn ivory keys, as her right hand lifts a slim black stylus toward the tablet from image 2 standing on the music stand with its sheet music. Snow outside the window, small silver hoop catching the light, tree-light bokeh behind.",
    mo="A smooth track to the left along the keyboard. 0–1s: her fingers run a quick phrase. 1–1.5s: she taps the tablet with the stylus to turn the page and drops back onto the keys; ends mid-phrase."),
 fr(7,7.5,9.0,"BODY","veo", refs="cast", ref="REF_NXT_sketch.jpg", txt="SKETCH LIKE PAPER", vo="sketch like paper,",
    kf="Close-up over her shoulder, 40mm. Only the young woman from image 1, same face, hair and rust cardigan, now has the tablet from image 2 laid flat on the closed piano lid and draws on it with a slim black stylus; the matte screen shows the graphite pencil sketch of sunflowers in a vase from image 2, the stylus tip touching a petal; the stylus in her hand is the only stylus in the frame. Snowy window light, a mug of tea beside the tablet, tree-light bokeh.",
    mo="A slow arc over her shoulder. 0–1s: the stylus draws a long petal line that appears under the tip. 1–1.5s: she shades the petal and smiles; ends mid-stroke."),
 fr(8,9.0,10.0,"BODY","local", local="NXT_S7_ink.jpg", txt="ONE-KEY INK PAPER", vo="one-key ink mode,"),
 fr(9,10.0,12.0,"BODY","veo", refs="cast", ref="REF_NXT.jpg", txt="EASY ON THE EYES", vo="easy on the eyes.",
    kf="Medium shot, eye level, 35mm. Evening at the upright piano: the young woman and her younger brother from image 1, same faces and clothes, sit side by side on the bench under a warm brass lamp; she points at the sheet music on the tablet from image 2 standing on the music stand and explains the first note while he looks up at her, his small hands hovering over worn keys. A small beagle sleeps on the rug beside the piano bench. Deep blue window with falling snow, tree lights in the corner.",
    mo="A slow push-in. 0–1s: she tells him something, he presses the first key and looks up at her. 1–2s: both laugh, she hugs his shoulder and the beagle lifts its head; ends mid-laugh."),
 fr(10,12.0,13.5,"CTA","local", local="END_NXT_front.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Black Friday at TCL.com.", fine=NXT_FINE),
 fr(11,13.5,15.0,"CTA","local", local="END_NXT_side.jpg", txt="BLACK FRIDAY DEAL — SHOP AT TCL.COM", vo="Black Friday at TCL.com.", fine=NXT_FINE),
]

ADS = {
 "QM7L-A": {"ref": "REF_QM7L_village.jpg", "frames": QM7L},
 "QM8L-A": {"ref": "REF_QM8L_sun.jpg", "frames": QM8L},
 "NXT-A":  {"ref": "REF_NXT.jpg", "frames": NXT},
}

if __name__ == "__main__":
    C = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "composites")
    for k, a in ADS.items():
        fs = a["frames"]; gen = [f for f in fs if f["locked"]["engine"] != "local"]
        assert all(f["endSec"] - f["startSec"] <= 2.0 + 1e-6 for f in fs), k
        assert all(abs(fs[i]["startSec"] - fs[i - 1]["endSec"]) < 1e-6 for i in range(1, len(fs))), k
        assert abs(fs[-1]["endSec"] - 15.0) < 1e-6, k
        files = {f["locked"].get(x) for f in fs for x in ("localImage", "refImage")} - {None} | {a["ref"]}
        missing = [f for f in files if not os.path.exists(f"{C}/{f}")]; assert not missing, (k, missing)
        vid = {"kling": 42, "veo": 12, "veo1080": 20}
        print(k, len(fs), "frames,", len(gen), "generated, video ≈", sum(vid[f["locked"]["engine"]] for f in gen), "¢, images ≈", 1 + len(gen) + sum(1 for f in fs if f["locked"].get("compare")))

# v7 (2026-10-04): first-3-s sale pitch, live-price fine print and product-located zoom targets were applied
# to the stored storyboards directly — see scratchpad zoom/targets.json and promo-campaign-planning.md "Edit rules".
