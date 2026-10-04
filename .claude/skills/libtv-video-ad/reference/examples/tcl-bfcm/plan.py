"""TCL Black Friday / Cyber Monday 15 s ad plan — data (reused by the render step) + .docx report."""
import json, os

TV_DISCLAIMER = ("*Free standard professional installation with an eligible TV purchased on TCL.com, performed by TCL's "
                 "authorized third-party partner. Standard wall mounting labor included; mount hardware, parts and "
                 "non-standard work extra. Availability varies by location.")

PRODUCTS = [
  {"id": "QM7L", "name": "TCL QM7L Series SQD-Mini LED 4K Google TV", "rank": "官网 Best Seller 第 1（电视按销量排序第 1）",
   "url": "https://us.tcl.com/products/qm7l-series-sqd-mini-led-4k-uhd-hdr-smart-tv-with-google-tv",
   "prices": '55" $799.99（原 $1,199.99）· 65" $999.99 · 75" $1,199.99 · 85" $1,499.99 · 98" $2,499.99（原 $3,999.99）',
   "specs": ["SQD-Mini LED，100% BT.2020 量子点色域", "峰值亮度 up to 3,000 nits", "2,100+ 分区控光", "144Hz 原生刷新；Game Accelerator 288 VRR + FreeSync；4× HDMI 2.1",
             "AI 画质优化（AIPQ）", "Dolby Vision IQ + Dolby Atmos", "Google TV；HVA 2.0 Pro 面板"],
   "sell": ["亮：3,000 nits，白天客厅也不发灰（最适合“阳光直射”对比镜头）", "黑：2,100+ 分区，夜景纯黑", "快：144Hz 体育/游戏",
            "价：Best Seller + 55\" 立省 $400（现价）", "装：符合免费专业安装（QM7L 在官网合格清单内）"],
   "install": True},
  {"id": "QM8L", "name": "TCL QM8L Series SQD-Mini LED 4K Google TV", "rank": "官网 Best Seller 第 2",
   "url": "https://us.tcl.com/products/qm8l-series-sqd-mini-led-4k-uhd-hdr-smart-tv-with-google-tv",
   "prices": '65" $1,499.99（原 $2,499.99）· 75" $1,799.99 · 85" $2,799.99 · 98" $4,499.99（原 $5,999.99）',
   "specs": ["峰值亮度 up to 6,000 nits（QM7L 的 2 倍）", "4,000+ 分区控光，26-bit 动态调光", "WHVA 2.0 Ultra 面板 + ZeroBorder 无边设计",
             "4× 全带宽 HDMI 2.1，全部 4K@144Hz", "TSR AI Pro 处理器；Google TV + Gemini", "Audio by Bang & Olufsen；Dolby Vision IQ + Atmos FlexConnect"],
   "sell": ["旗舰亮度 6,000 nits：落地窗/大客厅", "4 个满速 HDMI 2.1：多主机玩家", "ZeroBorder 边到边：装上墙像一幅画", "B&O 音效", "装：符合免费专业安装"],
   "install": True},
  {"id": "NXTPAPER14", "name": "TCL NXTPAPER 14 平板", "rank": "NXTPAPER 平板系列首位",
   "url": "https://us.tcl.com/products/nxtpaper-14",
   "prices": "$349.97（原 $469.99）",
   "specs": ['14.3" NXTPAPER 屏，2400×1600，60Hz', "Color Paper / Ink Paper 模式，实体 NXTPAPER 键一键切换", "防眩光、低蓝光、护眼提醒",
             "10,000mAh 电池（全天）", "MediaTek MT8781 八核 2.2GHz；最高 256GB；Android 14", "Extend Mode：当 PC 第二屏；分屏多任务",
             "四扬声器 + 双麦降噪；322×222×6.95 mm，760 g", "T-Pen（4096 级压感）"],
   "sell": ["整页 A4：乐谱、文献、漫画不用缩放（评测与音乐人场景最强）", "像纸一样：不反光、可长时间阅读（墨水纸模式）", "全天续航：学生一整天",
            "第二屏：Extend Mode", "礼物：$349.97 黑五送礼价位"],
   "install": False},
]

# Each ad: 15 s, 9:16. t = seconds; cam = camera move; eng = render engine for the clip.
ADS = [
 # ---------------- QM7L ----------------
 {"id": "QM7L-A", "product": "QM7L", "title": "Doorbell to Done（按门铃到装好）", "event": "Black Friday", "hook": "产品冲击 p",
  "audience": "主流换机家庭、第一次买大屏的人", "insight": "买大电视最大的心理障碍不是价格，而是“怎么搬、怎么挂”。",
  "shots": [
   ("0.0–1.5", "门铃响，门一开：两名安装师傅抬着 TCL 大纸箱进门（只拍手臂与箱体，箱面无字）", "whip→handheld follow", "BLACK FRIDAY", "Kling"),
   ("1.5–3.0", "水平仪贴墙，电钻打孔，木屑飞起（特写）", "fast push-in", "FREE PRO INSTALL*", "Kling"),
   ("3.0–4.5", "两人把 QM7L 抬上墙并扣入挂架", "arc 40°", "—", "Kling"),
   ("4.5–6.0", "屏幕点亮：阳光直射的客厅里画面依然鲜亮（屏内合成官方安全画面）", "pull-out reveal", "3,000 NITS", "Veo"),
   ("6.0–8.0", "孩子扑上沙发，爸爸接过遥控器；窗光扫过脸", "handheld follow", "—", "Kling"),
   ("8.0–10.0", "游戏手柄特写，屏上高速赛车不拖影", "track right", "144HZ SMOOTH", "Veo"),
   ("10.0–15.0", "片尾卡：官方 QM7L 产品图合成 + 价格 + CTA + 免责声明", "slow push", "[黑五价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Black Friday just rang the doorbell. TCL's best-selling QM7L — and we install it free. Three thousand nits beats the glare. Grab yours at TCL.com.",
  "why": "前 1.5 秒出现“安装师傅进门”，把“免费安装”变成画面而不是字幕；5 秒内完成“装好+点亮”的回报。"},
 {"id": "QM7L-B", "product": "QM7L", "title": "Glare Wars（反光大战·感恩节球赛）", "event": "Black Friday（感恩节周）", "hook": "反差 c",
  "audience": "看球家庭、阳光客厅", "insight": "感恩节下午开球时阳光最强，老电视发灰是真实痛点。",
  "shots": [
   ("0.0–1.5", "感恩节客厅：老电视被窗光照得发灰，一家人眯眼凑近（通用橄榄球画面，无 NFL 标识）", "fast push-in", "CAN'T SEE THE GAME?", "Kling"),
   ("1.5–3.0", "爸爸无奈摊手，奶奶端着派走过", "handheld follow", "—", "Kling"),
   ("3.0–4.5", "甩镜头切到同一面墙：QM7L 已装好（安装师傅收工离开的背影）", "whip pan", "INSTALLED. FREE.*", "Kling"),
   ("4.5–6.5", "同样的阳光下，画面通透鲜艳", "arc 30°", "3,000 NITS", "Veo"),
   ("6.5–8.5", "达阵瞬间一家人跳起欢呼（声音：Atmos 观众欢呼）", "crane up", "DOLBY ATMOS", "Kling"),
   ("8.5–10.0", "夜景镜头：球场灯光与纯黑夜空", "rack focus", "2,100+ ZONES", "Veo"),
   ("10.0–15.0", "片尾卡：产品图 + 黑五价 + 安装说明 + CTA", "slow push", "[黑五价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Sun's out, game's on — and you can't see a thing? Meet the QM7L: three thousand nits, two thousand dimming zones. This Black Friday, TCL installs it free.",
  "why": "以“看不清比赛”的场景做反差钩子；安装镜头放在 3 秒处的转折点，让“免费安装”成为问题的解决方案。"},
 {"id": "QM7L-C", "product": "QM7L", "title": "Size Up, Zero Lifting（98 吋不用你搬）", "event": "Cyber Monday", "hook": "提问 q",
  "audience": "想上大尺寸但怕安装的人", "insight": "98\" 的阻力是体积与安装难度；免费安装直接消除它。",
  "shots": [
   ("0.0–1.5", "一个人站在比自己还高的纸箱前，抬头", "low-angle push-in", "COULD YOU LIFT 98\"?", "Kling"),
   ("1.5–3.0", "他试着推箱子，纹丝不动", "handheld", "—", "Kling"),
   ("3.0–4.5", "安装团队入画，接手", "track left", "WE DO THE LIFTING*", "Kling"),
   ("4.5–6.5", "98\" 上墙，人站在旁边做尺寸对比", "pull-out reveal", "98 INCHES", "Veo"),
   ("6.5–8.5", "屏内：山湖日落；人后退坐进沙发", "orbit 30°", "—", "Kling"),
   ("8.5–10.0", "细节：夜景纯黑 + 高光", "push-in", "2,100+ ZONES", "Veo"),
   ("10.0–15.0", "片尾卡：98\" 产品图 + 网一价 + CTA", "slow push", "[网一价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Ninety-eight inches. Could you lift that? You don't have to. Cyber Monday on TCL's QM7L — professional installation is on us. Go big at TCL.com.",
  "why": "用“你搬得动吗？”提问，把尺寸和安装绑在同一个画面；适合把 98\" 的折扣（现价立省 $1,500）作为网一主推。"},
 # ---------------- QM8L ----------------
 {"id": "QM8L-A", "product": "QM8L", "title": "Gallery Wall（像画一样挂上墙）", "event": "Black Friday", "hook": "产品冲击 p",
  "audience": "注重家居设计的高端用户", "insight": "旗舰电视的价值在“装上墙那一刻”；ZeroBorder 只有挂墙才最好看。",
  "shots": [
   ("0.0–1.5", "白墙上一个空的画框位置，镜头快速推入", "fast push-in", "BLACK FRIDAY", "Veo"),
   ("1.5–3.0", "安装师傅用水平仪校正，手指抹过墙面", "rack focus", "FREE PRO INSTALL*", "Kling"),
   ("3.0–5.0", "QM8L 贴墙落位，边到边画面亮起（屏内：艺术画面）", "orbit 40°", "ZEROBORDER", "Veo"),
   ("5.0–7.0", "落地窗正午，画面高光依旧锐利", "pull-out", "6,000 NITS", "Veo"),
   ("7.0–8.5", "女主人放下咖啡坐下，音乐响起", "handheld follow", "SOUND BY B&O", "Kling"),
   ("8.5–10.0", "夜景：烛光 + 纯黑画面", "slow arc", "4,000+ ZONES", "Veo"),
   ("10.0–15.0", "片尾卡：QM8L 侧面金属边框产品图 + 价格 + CTA", "slow push", "[黑五价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "No border. No glare. No weekend lost to drilling. The QM8L: six thousand nits, sound by Bang & Olufsen — installed free by TCL's pros this Black Friday.",
  "why": "用三个“No”节奏做 VO，把设计、亮度和“不用自己钻墙”放在同一句；画面以挂墙落位为高潮。"},
 {"id": "QM8L-B", "product": "QM8L", "title": "Four Consoles（四台主机全满速）", "event": "Cyber Monday", "hook": "产品冲击 p",
  "audience": "主机/PC 玩家", "insight": "玩家在意接口；QM8L 的 4 个满速 HDMI 2.1 是同价位少见的硬差异。",
  "shots": [
   ("0.0–1.5", "四个手柄“啪”地摆上桌面（俯拍）", "fast crane down", "4 × HDMI 2.1", "Kling"),
   ("1.5–3.0", "四根线依次插入背板接口（插入特写，用官方背板图做参考）", "track", "ALL 4K@144HZ", "Veo"),
   ("3.0–4.5", "安装师傅把电视推平上墙，玩家在旁边打气", "arc 30°", "WE MOUNT. YOU PLAY.*", "Kling"),
   ("4.5–6.5", "玩家甩身坐下，赛车画面高速掠过", "whip in", "—", "Kling"),
   ("6.5–8.5", "黑暗房间里屏幕高光爆发", "push-in", "6,000 NITS", "Veo"),
   ("8.5–10.0", "朋友们挤进沙发一起玩", "pull-out", "—", "Kling"),
   ("10.0–15.0", "片尾卡：QM8L + 网一价 + CTA", "slow push", "[网一价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Four consoles. Four full-speed HDMI 2.1 ports. 4K at 144. You play — TCL's pros mount it free. The QM8L: Cyber Monday's flagship move.",
  "why": "对玩家只讲他们在乎的硬参数；“We mount, you play”让安装服务转化为玩家语言。"},
 {"id": "QM8L-C", "product": "QM8L", "title": "The Brightest Room（最亮的那面墙）", "event": "Black Friday → Cyber Monday", "hook": "反差 c",
  "audience": "大客厅、落地窗户型", "insight": "落地窗是旗舰亮度的最佳证明；白天到夜晚的一镜转场同时证明亮与黑。",
  "shots": [
   ("0.0–1.5", "正午落地窗客厅，强光把画面照得刺眼", "fast push-in", "WALL OF WINDOWS?", "Veo"),
   ("1.5–3.0", "QM8L 画面依旧通透，人物走进阳光里", "track", "6,000 NITS", "Kling"),
   ("3.0–5.0", "一个连续升降镜头：白天→黄昏（光线变化）", "crane up", "—", "Veo"),
   ("5.0–7.0", "夜晚电影之夜，纯黑星空，毯子与爆米花", "slow arc", "4,000+ ZONES", "Veo"),
   ("7.0–8.5", "回想白天：安装师傅收工、和主人击掌", "handheld", "INSTALLED FREE*", "Kling"),
   ("8.5–10.0", "边到边画面特写", "orbit 30°", "ZEROBORDER", "Veo"),
   ("10.0–15.0", "片尾卡：QM8L + 价格 + CTA", "slow push", "[黑五/网一价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Wall of windows? Bring it. Six thousand nits by day, four thousand dimming zones by night. TCL QM8L — Black Friday pricing, professional installation on us.",
  "why": "一镜从白天到夜晚，同时证明亮度和黑位；安装放在情绪高点后的回顾镜头里。"},
 # ---------------- NXTPAPER 14 ----------------
 {"id": "NXT-A", "product": "NXTPAPER14", "title": "Full Page, No Glare（整页乐谱，不反光）", "event": "Black Friday（送礼）", "hook": "反差 c",
  "audience": "学琴学生、乐手、家长送礼", "insight": "乐谱 App 在小屏需要缩放和频繁翻页；14 吋能完整显示一页 A4。",
  "shots": [
   ("0.0–1.5", "钢琴上一叠纸质乐谱被风吹散（反差）", "whip", "STILL USING PAPER?", "Kling"),
   ("1.5–3.0", "NXTPAPER 14 放上谱架，整页 A4 乐谱，阳光下不反光", "push-in", "FULL A4 PAGE", "Veo"),
   ("3.0–5.0", "手指在琴键上弹奏，笔尖轻点翻页", "track", "PAPER-LIKE", "Kling"),
   ("5.0–7.0", "按下 NXTPAPER 键：屏幕从彩色切换为墨水纸模式", "rack focus", "INK PAPER MODE", "Veo"),
   ("7.0–8.5", "练琴两小时后，眼睛不累，微笑", "slow arc", "EASY ON EYES", "Kling"),
   ("8.5–10.0", "包装盒打开：平板 + 笔 + 保护套 [待确认套装内容]", "crane down", "READY OUT OF THE BOX", "Veo"),
   ("10.0–15.0", "片尾卡：官方产品图 + 价格 + CTA", "slow push", "$349.97 → [黑五价 占位]", "本地合成"),
  ],
  "vo": "A full page of music. No glare, no squinting. NXTPAPER 14 reads like paper — nothing to set up, just play. Black Friday gifting at TCL.com.",
  "why": "平板没有官方安装服务，所以把“包安装”转译为“开箱即用、零设置”；乐谱是评测中最具体、最有画面感的场景。"},
 {"id": "NXT-B", "product": "NXTPAPER14", "title": "The All-Day Student（全天学生）", "event": "Black Friday（送礼）", "hook": "提问 q",
  "audience": "高中/大学生与家长", "insight": "学生一天里要阅读、记笔记、看课，续航和护眼是家长买单的理由。",
  "shots": [
   ("0.0–1.5", "早上 8 点，背包甩上肩，平板塞进去", "whip → follow", "8 AM", "Kling"),
   ("1.5–3.0", "课堂上手写笔记（T-Pen）", "push-in", "TAKE NOTES", "Kling"),
   ("3.0–4.5", "图书馆读 PDF，墨水纸模式", "track", "READ LIKE PAPER", "Veo"),
   ("4.5–6.0", "分屏：课件 + 笔记", "arc 30°", "SPLIT SCREEN", "Veo"),
   ("6.0–8.0", "宿舍晚上 10 点追剧，四扬声器", "pull-out", "10 PM — STILL GOING", "Kling"),
   ("8.0–10.0", "电量图标特写（本地合成 UI，非生成）", "push-in", "10,000 mAh", "本地合成"),
   ("10.0–15.0", "片尾卡：产品图 + 礼物丝带 + 价格 + CTA", "slow push", "GIFT IT · [黑五价 占位]", "本地合成"),
  ],
  "vo": "Eight a.m. to ten p.m. — one tablet. Notes, reading, shows, and eyes that don't burn out. NXTPAPER 14, ready out of the box. Black Friday at TCL.com.",
  "why": "用时间作为结构（8 AM → 10 PM），把续航变成故事；“开箱即用”承接“包安装”的诉求。"},
 {"id": "NXT-C", "product": "NXTPAPER14", "title": "Second Screen, Zero Hassle（第二屏，零折腾）", "event": "Cyber Monday", "hook": "提问 q",
  "audience": "居家办公、学生党", "insight": "想要第二块屏幕但不想再装一台显示器；Extend Mode 让平板当第二屏。",
  "shots": [
   ("0.0–1.5", "笔记本电脑前，窗口叠了一大堆（屏幕内容本地合成）", "fast push-in", "NEED A 2ND SCREEN?", "Veo"),
   ("1.5–3.0", "把 NXTPAPER 14 立在电脑旁", "arc 30°", "NO MONITOR TO INSTALL", "Kling"),
   ("3.0–5.0", "窗口拖到平板上：扩展屏", "track", "EXTEND MODE", "Veo"),
   ("5.0–7.0", "下班：切换墨水纸模式，靠在沙发上读书", "pull-out", "THEN, READ LIKE PAPER", "Kling"),
   ("7.0–8.5", "笔尖批注 PDF", "rack focus", "T-PEN", "Veo"),
   ("8.5–10.0", "6.95 mm 侧面 + 760 g 单手拿起", "orbit", "6.95 MM", "Veo"),
   ("10.0–15.0", "片尾卡：产品图 + 网一价 + CTA", "slow push", "[网一价 占位] · SHOP TCL.COM", "本地合成"),
  ],
  "vo": "Need a second screen? Skip the monitor install. NXTPAPER 14 extends your PC, then turns paper-soft for reading after work. Cyber Monday at TCL.com.",
  "why": "把“安装”诉求转译为“不用再装显示器”；工作 + 阅读两用，覆盖网一的科技人群。"},
]

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    json.dump({"products": PRODUCTS, "ads": ADS, "tv_disclaimer": TV_DISCLAIMER}, open(f"{here}/plan.json", "w"), ensure_ascii=False, indent=1)
    for a in ADS:
        n = len(a["vo"].split())
        print(a["id"], f"VO {n} words ≈ {n/2.6:.1f}s", "max shot", max(float(s[0].split("–")[1]) - float(s[0].split("–")[0]) for s in a["shots"][:-1]), "s")
