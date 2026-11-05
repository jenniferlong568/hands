/*
  Snowflake Hands — 指尖雪花互动
  参考作品: https://openprocessing.org/@reona396/1504042
  技术栈: p5.js + ml5.js (handPose) + p5.FIP (bloom 辉光)
*/

let video;       // 摄像头画面
let handPose;    // ml5 手部识别模型
let hands = [];  // 当前识别到的手
let bloom;       // 辉光滤镜（shader）
let pg;          // 离屏画布，专门绘制雪花

let particles = []; // all snowflakes, raindrops and cloud puffs
let label;          // on-screen weather label (HTML overlay)

const rainPalette = ["#9FD8FF", "#54BFCB", "#227EB9", "#BFE6FF", "#1565C0"];
const cloudPalette = ["#FFFFFF", "#D9DEE8", "#B8C2D1", "#E8E4F0"];

// cover-fit 参数：真实视频铺满画布（不拉伸，裁切多余部分）
let coverScale, videoDrawW, videoDrawH, videoOffsetX, videoOffsetY;

const palette = [  // 雪花随机取色的调色板
  "#F1E1A0",
  "#DE53B6",
  "#E2A0DA",
  "#54BFCB",
  "#227EB9",
  "#8B00FF",
  "#C2185B",
  "#00796B",
  "#1565C0",
  "#6A1B9A",
];

// 五个指尖的关键点名称
const fingertipNames = [
  "thumb_tip",
  "index_finger_tip",
  "middle_finger_tip",
  "ring_finger_tip",
  "pinky_finger_tip",
];

function preload() {
  // 预加载手部识别模型（最多2只手，画面左右镜像）
  handPose = ml5.handPose({ maxHands: 2, flipped: true });
}

// 读取摄像头真实像素尺寸（手机上常与桌面不同）
function getSourceSize() {
  const vw =
    (video && video.elt && video.elt.videoWidth) ||
    (video && video.width) ||
    640;
  const vh =
    (video && video.elt && video.elt.videoHeight) ||
    (video && video.height) ||
    480;
  return { vw: max(1, vw), vh: max(1, vh) };
}

// 计算 cover-fit：视频铺满当前画布
function updateVideoCoverTransform() {
  const { vw, vh } = getSourceSize();
  coverScale = max(width / vw, height / vh);
  videoDrawW = vw * coverScale;
  videoDrawH = vh * coverScale;
  videoOffsetX = (width - videoDrawW) / 2;
  videoOffsetY = (height - videoDrawH) / 2;
}

// 把 ml5 指尖坐标（视频空间）映射到画布空间
function videoToCanvas(vx, vy) {
  return {
    x: videoOffsetX + vx * coverScale,
    y: videoOffsetY + vy * coverScale,
  };
}

// iOS Safari 必须 playsinline，否则画面可能卡住 / 手势失效
function prepareVideoElement(capture) {
  const elt = capture.elt;
  elt.setAttribute("playsinline", "");
  elt.setAttribute("webkit-playsinline", "");
  elt.muted = true;
  elt.autoplay = true;
  const playPromise = elt.play && elt.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function createOffscreenGraphics() {
  pg = createGraphics(width, height);
  pg.angleMode(DEGREES);
}

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL); // WEBGL 模式（p5.FIP 必需）

  bloom = createFilterShader(fip.bloom);     // 创建辉光 shader
  createOffscreenGraphics();

  label = createDiv("Show your hand ✋");
  label.style("position", "fixed");
  label.style("top", "16px");
  label.style("left", "50%");
  label.style("transform", "translateX(-50%)");
  label.style("padding", "8px 18px");
  label.style("border-radius", "999px");
  label.style("background", "rgba(0,0,0,0.45)");
  label.style("color", "#fff");
  label.style("font", "600 20px system-ui, sans-serif");
  label.style("pointer-events", "none");
  label.style("z-index", "10");

  // iOS 上 WebGPU 可能导致关键点错位，优先 WebGL
  if (typeof ml5.setBackend === "function") {
    try {
      await ml5.setBackend("webgl");
    } catch (e) {
      // 忽略：部分环境无此 API
    }
  }

  updateVideoCoverTransform();

  // 前置摄像头；不强制 size，避免手机端被拉伸成错误比例
  video = createCapture(
    {
      audio: false,
      video: {
        facingMode: "user",
      },
    },
    () => {
      prepareVideoElement(video);
      updateVideoCoverTransform();
    }
  );
  prepareVideoElement(video);
  video.hide();

  handPose.detectStart(video, gotHands);      // 开始手部追踪

  angleMode(DEGREES);
  noStroke();
}

// 手部识别回调：每帧更新 hands
function gotHands(results) {
  hands = results;
}

function draw() {
  updateVideoCoverTransform();

  translate(-width / 2, -height / 2); // WEBGL 原点居中，移到左上角

  background(0); // 黑色背景（视频稍后叠加，辉光只作用于雪花）

  // --- 在离屏画布 pg 上绘制雪花 ---
  pg.blendMode(BLEND);
  pg.background(0);
  pg.blendMode(ADD); // 加法混合：重叠处更亮

  spawnWeather();
  updateLabel();

  for (let i = 0; i < particles.length; i++) {
    particles[i].move();
    particles[i].display();
  }

  for (let j = particles.length - 1; j >= 0; j--) {
    if (particles[j].isFinished) {
      particles.splice(j, 1); // 从后往前删除，避免索引错位
    }
  }

  // --- 合成到主画布并加辉光 ---
  blendMode(ADD);
  image(pg, 0, 0, width, height); // 黑色=透明，只显示雪花
  blendMode(BLEND);

  bloom.setUniform("intensity", 0.9); // 辉光强度
  bloom.setUniform("glow", 2.0);      // 辉光扩散范围
  filter(bloom);                       // 此时画布只有雪花 → 只有雪花发光

  // --- 辉光后再叠加镜像摄像头画面（视频不受辉光影响）---
  if (!video) return; // async setup: camera may not exist yet on the first frames
  blendMode(SCREEN);
  push();
  translate(width, 0);
  scale(-1, 1); // 左右镜像，像照镜子
  image(video, videoOffsetX, videoOffsetY, videoDrawW, videoDrawH);
  pop();
  blendMode(BLEND);
}

// ---------- Weather from finger direction ----------
// Fingers up → snow, fingers pointing forwards (at the camera, or sideways) → clouds,
// fingers down → rain.

// If wrist→middle-fingertip is shorter than this × knuckle width, the fingers are
// foreshortened, i.e. pointing towards the camera. Raise it if "cloudy" is hard to trigger.
const FORWARD_RATIO = 1.3;
// How strongly vertical the fingers must be to count as up/down (1 = 45°, 0.7 ≈ 35°).
const VERTICAL_BIAS = 0.7;
// Frames a new direction must hold before the weather switches (stops flicker).
const STABLE_FRAMES = 4;

const handStates = {}; // per hand: { weather, candidate, count }

function kp(hand, name) {
  return hand.keypoints.find((k) => k.name === name);
}

// Classify one frame of one hand as "snow", "cloudy" or "rain".
function classifyHand(hand) {
  const wrist = kp(hand, "wrist");
  const tip = kp(hand, "middle_finger_tip");
  const indexKnuckle = kp(hand, "index_finger_mcp");
  const pinkyKnuckle = kp(hand, "pinky_finger_mcp");
  if (!wrist || !tip || !indexKnuckle || !pinkyKnuckle) return null;

  const dx = tip.x - wrist.x;
  const dy = tip.y - wrist.y; // screen y grows downwards
  const len = Math.hypot(dx, dy);
  const palmW = Math.hypot(
    indexKnuckle.x - pinkyKnuckle.x,
    indexKnuckle.y - pinkyKnuckle.y
  );

  if (len < palmW * FORWARD_RATIO) return "cloudy";    // pointing at the camera
  if (-dy > Math.abs(dx) * VERTICAL_BIAS) return "snow"; // pointing up
  if (dy > Math.abs(dx) * VERTICAL_BIAS) return "rain";  // pointing down
  return "cloudy";                                       // pointing sideways/forwards
}

// Smooth the per-frame classification so the weather doesn't flicker.
function stableWeather(key, raw) {
  let s = handStates[key];
  if (!s) s = handStates[key] = { weather: raw, candidate: raw, count: 0 };
  if (raw === s.weather) {
    s.count = 0;
  } else if (raw === s.candidate) {
    if (++s.count >= STABLE_FRAMES) {
      s.weather = raw;
      s.count = 0;
    }
  } else {
    s.candidate = raw;
    s.count = 1;
  }
  return s.weather;
}

let currentWeathers = []; // for the on-screen label

function spawnWeather() {
  currentWeathers = [];
  if (!hands || hands.length === 0) return; // 没检测到手就跳过

  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i];
    const raw = classifyHand(hand);
    if (!raw) continue;
    const weather = stableWeather(hand.handedness || i, raw);
    currentWeathers.push(weather);

    const tips = hand.keypoints.filter((k) => fingertipNames.includes(k.name));

    for (const t of tips) {
      const pos = videoToCanvas( // 视频坐标 → 画布坐标
        t.x + random(-5, 5),
        t.y + random(-5, 5)
      );
      if (weather === "snow" && frameCount % 2 === 0) {
        particles.push(new Snowflake(pos.x, pos.y));
      } else if (weather === "rain") {
        // several drops per fingertip per frame
        for (let n = 0; n < 2; n++) particles.push(new RainDrop(pos.x, pos.y));
      } else if (weather === "cloudy" && frameCount % 5 === 0) {
        particles.push(new CloudPuff(pos.x, pos.y));
      }
    }
  }
}

function updateLabel() {
  if (!label) return;
  const icons = { snow: "❄️ Snow", cloudy: "☁️ Cloudy", rain: "🌧️ Rain" };
  label.html(
    currentWeathers.length
      ? [...new Set(currentWeathers)].map((w) => icons[w]).join("  ·  ")
      : "Show your hand ✋"
  );
}

function touchStarted() {
  // 部分 iOS 需一次用户手势才会真正开始播摄像头
  if (video && video.elt && video.elt.paused) {
    prepareVideoElement(video);
  }
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  createOffscreenGraphics();
  updateVideoCoverTransform();
}

class Snowflake {
  constructor(tmpX, tmpY) {
    this.ox = tmpX + random(-5, 5); // 起始 x（带随机偏移）
    this.oy = tmpY + random(-5, 5); // 起始 y

    this.oyStep = random(0.4, 1.1);  // 下落速度
    this.oxStep = random(-0.5, 0.5); // 水平漂移

    this.angle = random(360);        // 初始旋转角度
    this.spin = random(-2.5, 2.5);  // 旋转速度

    this.sizeMax = random(12, 26);   // 最大尺寸

    this.lifeMax = random(50, 150) * 0.7; // 寿命（帧数）
    this.life = this.lifeMax;
    this.isFinished = false;

    this.c = random(palette);        // 随机颜色
    this.weight = random(1.1, 2.2);  // 线条粗细

    // ---- 程序化生成雪花形状（每朵都不同）----
    this.arms = 6;                   // 六角对称
    this.type = floor(random(3));    // 0=树枝型 1=星形板 2=蕨叶型

    this.branches = [];              // 侧枝参数
    let n = floor(random(2, 5));
    for (let k = 0; k < n; k++) {
      this.branches.push({
        pos: random(0.25, 0.9),      // 侧枝在主枝上的位置（比例）
        ang: random(28, 58),         // 侧枝分叉角度
        len: random(0.18, 0.42),     // 侧枝长度（相对主枝）
      });
    }

    this.hasCore = random() < 0.6;   // 60% 概率画中心六边形
    this.coreR = random(0.1, 0.22);
    this.hasTip = random() < 0.5;    // 50% 概率画顶端横杠
    this.tipLen = random(0.12, 0.22);
  }

  move() {
    // 大小随寿命脉动：出现→变大→消失
    this.s =
      this.sizeMax * sin(map(this.life, this.lifeMax, 0, 180, 0));

    this.oy += this.oyStep;  // 下落
    this.ox += this.oxStep;  // 漂移
    this.angle += this.spin; // 旋转

    this.life--;
    if (this.life < 0) this.isFinished = true; // 寿命耗尽
  }

  display() {
    let r = this.s;
    if (r <= 0.1) return;

    // 画到离屏画布 pg（描边风格，像冰晶）
    pg.push();
    pg.translate(this.ox, this.oy);
    pg.rotate(this.angle);
    pg.noFill();
    pg.stroke(this.c);
    pg.strokeWeight(this.weight);
    pg.strokeCap(ROUND);

    // 中心六边形
    if (this.hasCore) {
      let cr = r * this.coreR;
      pg.beginShape();
      for (let i = 0; i < 6; i++) {
        pg.vertex(cr * cos(60 * i), cr * sin(60 * i));
      }
      pg.endShape(CLOSE);
    }

    // 六条主枝（旋转 60° 复制）
    for (let a = 0; a < this.arms; a++) {
      pg.push();
      pg.rotate((360 / this.arms) * a);

      pg.line(0, 0, 0, -r); // 主枝（向上）

      // 侧枝（V 形分叉，左右对称）
      for (let b = 0; b < this.branches.length; b++) {
        let br = this.branches[b];
        let by = -r * br.pos;
        let bl = r * br.len;
        pg.push();
        pg.translate(0, by);
        pg.rotate(br.ang);
        pg.line(0, 0, 0, -bl);
        pg.rotate(-2 * br.ang);
        pg.line(0, 0, 0, -bl);
        pg.pop();

        // 星形板类型：在侧枝根部加横杠
        if (this.type === 1) {
          let pl = bl * 0.5;
          pg.line(-pl * 0.4, by, pl * 0.4, by);
        }
      }

      // 顶端横杠装饰
      if (this.hasTip) {
        let tl = r * this.tipLen;
        pg.line(-tl, -r * 0.9, tl, -r * 0.9);
      }

      pg.pop();
    }

    pg.pop();
  }
}

// ---------- Rain: streaks that fall fast from the fingertips ----------
class RainDrop {
  constructor(x, y) {
    this.x = x + random(-6, 6);
    this.y = y + random(-6, 6);
    this.vx = random(-0.6, 0.6);
    this.vy = random(5, 9);       // initial fall speed
    this.len = random(10, 24);    // streak length
    this.weight = random(1, 2);
    this.c = random(rainPalette);
    this.lifeMax = random(40, 70);
    this.life = this.lifeMax;
    this.isFinished = false;
  }

  move() {
    this.vy += 0.35;              // gravity
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    if (this.life < 0 || this.y > height + 40) this.isFinished = true;
  }

  display() {
    const col = pg.color(this.c);
    col.setAlpha(255 * constrain(this.life / 15, 0, 1)); // fade at the end
    pg.stroke(col);
    pg.strokeWeight(this.weight);
    pg.strokeCap(ROUND);
    // streak points back up along the direction of travel
    const k = this.len / this.vy;
    pg.line(this.x, this.y, this.x - this.vx * k, this.y - this.len);
  }
}

// ---------- Cloud: soft puffs that grow, drift and fade ----------
class CloudPuff {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = random(-0.6, 0.6);
    this.vy = random(-0.4, 0.1);  // drift slightly upwards
    this.r = random(16, 30);
    this.c = random(cloudPalette);
    this.lifeMax = random(70, 130);
    this.life = this.lifeMax;
    this.isFinished = false;

    // a cloud is a cluster of overlapping circles
    this.blobs = [];
    const n = floor(random(4, 8));
    for (let i = 0; i < n; i++) {
      this.blobs.push({
        dx: random(-1.2, 1.2),
        dy: random(-0.45, 0.35),
        rr: random(0.5, 1),
      });
    }
  }

  move() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
    if (this.life < 0) this.isFinished = true;
  }

  display() {
    const t = 1 - this.life / this.lifeMax;         // 0 → 1 over its life
    const grow = lerp(0.5, 1.4, t);                  // puff expands
    const alpha = 45 * sin(t * 180);                 // fade in, then out (DEGREES)
    if (alpha <= 0) return;
    const col = pg.color(this.c);
    col.setAlpha(alpha);
    pg.noStroke();
    pg.fill(col);
    const r = this.r * grow;
    for (const b of this.blobs) {
      pg.circle(this.x + b.dx * r, this.y + b.dy * r, 2 * r * b.rr);
    }
  }
}
