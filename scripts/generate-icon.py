import os
from collections import deque
from PIL import Image, ImageFilter
import numpy as np

source_path = r"C:\Users\Nrohtas\.gemini\antigravity-ide\brain\64ecf70d-5a2c-45cf-afbb-839618615f71\plkgap_icon_v2_monogram_p_1791270706537.jpg"
build_dir = r"e:\Dashboard\PlkGap\build"
assets_dir = r"e:\Dashboard\PlkGap\src\renderer\src\assets"

os.makedirs(build_dir, exist_ok=True)
os.makedirs(assets_dir, exist_ok=True)

src = Image.open(source_path).convert("RGB")
arr = np.array(src)
h, w, _ = arr.shape

# 1. Flood fill จากขอบภาพทั้ง 4 ด้าน เพื่อระบุพิกเซลพื้นหลังสีดำ/เทาเข้มภายนอก squircle
visited = np.zeros((h, w), dtype=bool)
queue = deque()

# ขอบบนและขอบล่าง
for x in range(w):
    for y in [0, h - 1]:
        if arr[y, x].max() < 55 and not visited[y, x]:
            visited[y, x] = True
            queue.append((y, x))

# ขอบซ้ายและขอบขวา
for y in range(h):
    for x in [0, w - 1]:
        if arr[y, x].max() < 55 and not visited[y, x]:
            visited[y, x] = True
            queue.append((y, x))

# ขยายพื้นที่พื้นหลังสีดำ (BFS Flood Fill)
while queue:
    cy, cx = queue.popleft()
    for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        ny, nx = cy + dy, cx + dx
        if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
            if arr[ny, nx].max() < 55:
                visited[ny, nx] = True
                queue.append((ny, nx))

print(f"Detected {visited.sum()} background pixels out of {w * h}")

# 2. สร้าง Foreground Alpha Mask (255 = ตัวไอคอน, 0 = พื้นหลังโปร่งใส)
fg_mask = Image.fromarray((~visited).astype(np.uint8) * 255, mode="L")

# ลบขอบดำ (Erode 2-3px) และเกลี่ยขอบให้เรียบเนียน (Anti-aliasing Gaussian blur)
eroded_mask = fg_mask.filter(ImageFilter.MinFilter(3))
smooth_mask = eroded_mask.filter(ImageFilter.GaussianBlur(radius=1.5))

src_rgba = src.convert("RGBA")
src_rgba.putalpha(smooth_mask)

# 3. Crop ให้ตัวไอคอน squircle อยู่ตรงกลางพอดี
bbox = fg_mask.getbbox()
print(f"Foreground bounding box: {bbox}")

bw = bbox[2] - bbox[0]
bh = bbox[3] - bbox[1]
size = max(bw, bh)
cx = (bbox[0] + bbox[2]) // 2
cy = (bbox[1] + bbox[3]) // 2
pad = 12

crop_box = (
    max(0, cx - size // 2 - pad),
    max(0, cy - size // 2 - pad),
    min(w, cx + size // 2 + pad),
    min(h, cy + size // 2 + pad),
)

cropped = src_rgba.crop(crop_box)
print(f"Cropped box: {crop_box}, size: {cropped.size}")

# 4. Resize เป็น 512x512 ด้วย Lanczos คมชัดสูง
png_512 = cropped.resize((512, 512), Image.Resampling.LANCZOS)
png_512.save(os.path.join(build_dir, "icon.png"), format="PNG")
png_512.save(os.path.join(assets_dir, "app-icon.png"), format="PNG")

# 5. บันทึกเป็น multi-size Windows icon (.ico) พร้อมช่องโปร่งใส
ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
png_512.save(os.path.join(build_dir, "icon.ico"), format="ICO", sizes=ico_sizes)

print("Icon files with transparent background updated successfully!")
