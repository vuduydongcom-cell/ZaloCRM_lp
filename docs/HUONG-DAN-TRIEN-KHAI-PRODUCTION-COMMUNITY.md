# Hướng dẫn triển khai ZaloCRM **Community (Open-Source)** lên Production

> Runbook cho bản **Community** — bản mã nguồn mở, **không có** 4 nhóm tính năng extension.
> Các bước hạ tầng chung (backup, rollback, siết bảo mật) dùng chung với
> [`HUONG-DAN-TRIEN-KHAI-PRODUCTION.md`](./HUONG-DAN-TRIEN-KHAI-PRODUCTION.md).
> Bản Extension: [`HUONG-DAN-TRIEN-KHAI-PRODUCTION-EE.md`](./HUONG-DAN-TRIEN-KHAI-PRODUCTION-EE.md).
> Kiến trúc open-core: [`OPEN-CORE.md`](./OPEN-CORE.md).

---

## 0. Community có và KHÔNG có gì?

| Có (core) | KHÔNG có (extension — đã gỡ khỏi source) |
|---|---|
| Chat đa nick Zalo, realtime (Socket.IO) | ❌ Lead Pool |
| Danh bạ / CRM, chấm điểm (lead scoring) | ❌ Tự động hoá + Marketing (triggers, blocks, sequences, broadcasts, lists, care-session) |
| Lịch hẹn, nhắc hẹn | ❌ Facebook Lead Ads |
| RBAC, tổ chức, audit, đăng nhập | ❌ Tab "Riêng tư" (Privacy) bị **ẩn** (code vẫn còn nhưng cờ `isExtension=false`) |
| Tài khoản Zalo (quét QR), media/MinIO | |

**Đặc điểm quan trọng:**
- Thư mục `backend/src/_ee/` và `frontend/src/_ee/` **không tồn tại** trong source Community →
  code extension không thể dùng **và** không thể bẻ khoá.
- App tự nhận diện: khi `_ee/` vắng mặt, log boot là `Community edition — _ee bundle absent`,
  và mọi route extension trả **404**.
- `schema.prisma` **giống hệt** bản EE (có vài bảng "ngủ" không dùng) → vô hại, để 1 DB chạy được cả hai bản.

---

## 1. Lấy source Community

Community **không sửa tay** — nó được **sinh tự động** từ repo Extension (xoá `_ee/`).
Có 2 cách lấy:

**Cách A — clone repo Community đã publish** (nếu nhóm bạn đã đẩy lên remote công khai):
```bash
git clone <community-remote-url> zalocrm-community && cd zalocrm-community
```

**Cách B — tự sinh từ repo Extension** (chỉ người giữ bản private làm khi release):
```bash
# Trong repo Extension:
scripts/make-community.sh mirror <community-remote-url>   # cần: apt install git-filter-repo
# Script clone sạch, xoá _ee khỏi TOÀN BỘ lịch sử, rồi in lệnh push để bạn review trước khi đẩy.
```

Kiểm tra đúng là bản Community (KHÔNG có `_ee/`):
```bash
( ! ls backend/src/_ee >/dev/null 2>&1 && ! ls frontend/src/_ee >/dev/null 2>&1 ) \
  && echo "✓ Community source (no _ee)" || echo "✗ Đây là bản EE (còn _ee)"
```

---

## 2. Tạo `.env` (đầy đủ theo `.env.example`)

Giống bản EE nhưng **bỏ qua nhóm Facebook/automation** (không có trong Community). Bắt buộc:

| Biến | Ghi chú |
|---|---|
| `JWT_SECRET`, `ENCRYPTION_KEY` | `openssl rand -hex 32` mỗi cái |
| `DB_PASSWORD` | mật khẩu Postgres mạnh (KHỚP trong `DATABASE_URL`) |
| `APP_URL`, `CRM_LOGIN_URL` | domain prod, vd `https://sub.domain.com` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | đổi khác `minioadmin`; `S3_ACCESS_KEY`/`S3_SECRET_KEY` khớp tương ứng |
| `S3_PUBLIC_URL` | URL HTTPS công khai tới MinIO, vd `https://file.domain.com` (xem §5) |
| `ANTHROPIC_AUTH_TOKEN` … | tuỳ chọn, nếu dùng AI |

**Không cần** (an toàn nếu bỏ trống/không có): `TOKEN_ENCRYPTION_KEY`, `FB_*` — chỉ liên quan
Facebook Lead Ads (tính năng EE, không có trong Community).

Để mặc định (trỏ service nội bộ compose): `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`.

> `.env` đã được `.gitignore` + `.dockerignore` — không commit, không lọt vào image.

Sinh nhanh secret:
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "DB_PASSWORD=$(openssl rand -hex 16)"
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 16)"
```

---

## 3. Build + chạy + tạo DB

```bash
# clamav + backup là tuỳ chọn (antivirus mặc định TẮT) → chỉ chạy core services:
docker compose up -d --build app db redis minio minio-init     # ~3-8 phút lần đầu
docker compose ps                                              # app/db/redis/minio "Up"

docker exec zalo-crm-app npx prisma migrate deploy            # app KHÔNG tự migrate
docker compose restart app                                    # boot sạch sau khi có bảng
```

Kiểm tra:
```bash
curl -s -o /dev/null -w "root / -> %{http_code}\n" http://localhost:3080/        # 200
curl -s http://localhost:3080/api/v1/setup/status                               # {"needsSetup":true}
docker logs zalo-crm-app 2>&1 | grep -i "community edition"                      # Community edition — _ee bundle absent
```

> Khác bản EE: log boot **KHÔNG** có `[automation.engine] started` / `[lead-pool-cron]` — đúng,
> vì các subsystem đó nằm trong `_ee` (đã gỡ). Các cron core (lịch hẹn, health-check Zalo,
> intelligence, presence, friend-sync…) vẫn chạy.

---

## 4. Xác nhận đúng là bản Community (tính năng EE biến mất)

```bash
docker logs zalo-crm-app 2>&1 | grep -i "community edition"     # Community edition — _ee bundle absent

# Route EE phải KHÔNG tồn tại (404). (Bản EE sẽ là 401.)
for p in /api/v1/automation/triggers /api/v1/lead-pool/config; do
  echo -n "$p -> "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3080$p; done   # 404, 404

# Route core vẫn còn (401 = cần đăng nhập):
curl -s -o /dev/null -w "/api/v1/contacts -> %{http_code}\n" http://localhost:3080/api/v1/contacts   # 401
```
Trên UI: **không** thấy menu Tự động hoá / Marketing / Lead Pool / Facebook Lead Ads, và tab
**Riêng tư** trong Cài đặt → Tài khoản Zalo bị ẩn.

---

## 5. HTTPS qua Cloudflare Tunnel (2 Public Hostname)

Tunnel token (dashboard-managed) → vào **Zero Trust → Networks → Tunnels → Public Hostname**:

| Public hostname | Service |
|---|---|
| `sub.domain.com` | `http://localhost:3080` |
| `file.domain.com` | `http://localhost:9000` |

- #1 = app (WebSocket tự đi qua). #2 = MinIO cho `S3_PUBLIC_URL`. Bỏ #2 thì ảnh/sticker/logo
  trong chat không hiển thị.
- `S3_PUBLIC_URL` phải là **HTTPS công khai, không port lạ** (đừng dùng `http://...:9000` —
  CF không proxy port 9000; trang https tải ảnh http bị chặn mixed-content).

Kiểm tra:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sub.domain.com/                 # 200
curl -sI https://file.domain.com/minio/health/live | head -1                  # 200
```
(App đã `trustProxy: true` → cookie `Secure` + `wss://` chạy đúng sau tunnel.)

(Phương án Caddy + Let's Encrypt trỏ thẳng IP: xem §B5 runbook gốc, đổi domain.)

---

## 6. Tạo tài khoản chủ (owner) lần đầu

Mở `https://sub.domain.com` → trang **/setup** tự hiện → tạo tổ chức + owner. Kiểm tra:
```bash
curl -s https://sub.domain.com/api/v1/setup/status   # {"needsSetup":false} sau khi tạo
```
Sau đó **Cài đặt → Tài khoản Zalo → Thêm nick → quét QR** (KHÔNG mở Zalo Web cùng lúc).

---

## 7. Giấy phép & banner attribution (Apache 2.0)

ZaloCRM phát hành theo **Apache License 2.0**; banner attribution trên top-nav là **bắt buộc**
theo §4(d). Muốn ẩn hợp pháp → mua commercial license và điền key vào biến `FRIENDS` trong `.env`
(liên hệ `locnt@locnguyendata.com`). Không có key thì **giữ banner**.

---

## 8. Nâng cấp bản Community đang chạy (từ bản cũ → bản mới)

> **Idempotent + GIỮ dữ liệu.** Chi tiết bảo mật từng biến: runbook gốc
> [`HUONG-DAN-TRIEN-KHAI-PRODUCTION.md`](./HUONG-DAN-TRIEN-KHAI-PRODUCTION.md).

**Có gì mới ở bản này:** telegram-bridge (core — có ở Community), sequence delay/jitter, fix lead-pool
*(chỉ ảnh hưởng bản EE)*, clamav tag `1.4`. **Migration mới** (additive): `telegram_bridge_phase0`,
`sequence_step_jitter`. **Biến `.env` mới (tuỳ chọn):** `TELEGRAM_BRIDGE_BOT_TOKEN` (trống = cầu Telegram TẮT).

```bash
# B1 — BACKUP DB trước (bắt buộc)
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-truoc-nang-cap-$(date +%F-%H%M).sql

# B2 — Lấy code Community mới (clone mirror mới, hoặc sinh lại từ EE bằng make-community)
git pull

# B3 — Kiểm .env: GIỮ NGUYÊN JWT_SECRET / ENCRYPTION_KEY / DB_PASSWORD / MinIO (đổi = mất phiên/dữ liệu)

# B4 — Build lại, GIỮ DB (KHÔNG -v)
docker compose up -d --build app

# B5 — Migrate (BẮT BUỘC — LUÔN deploy, KHÔNG "migrate dev")
docker exec zalo-crm-app npx prisma migrate deploy

# B6 — Cutover: ép re-login 1 lần
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "UPDATE users SET jwt_token_version = jwt_token_version + 1;"
docker compose restart app
```

> 🛑 **CHỈ `up -d --build app`, KHÔNG `down -v`** (down -v xoá DB → mất tài khoản → đăng nhập lại bị
> đá về `/setup-password`). Kiểm tra sau nâng cấp: `curl ... :3080/` → 200; `grep "community edition"`
> trong log; `SELECT count(*) FROM users` > 0.

**Chuyển từ bản cũ/EE → Community (lưu ý dữ liệu):** schema giống hệt nên DB của 4 nhóm tính năng EE
(Lead Pool, Automation/Marketing, Facebook) **vẫn nằm nguyên trong các bảng "ngủ"** — vô hại, KHÔNG mất.
UI/route các tính năng đó biến mất ở Community. **Có thể đảo ngược**: deploy lại image EE (còn `_ee/`)
là các tính năng + dữ liệu hiện lại đầy đủ.

> Quy trình open-core: fix/feature ngoài `_ee/` ở repo Extension **tự động** chảy vào Community
> ở lần `make-community` kế tiếp — không cherry-pick. Đừng merge ngược Community → Extension.

### Rollback
```bash
git checkout <branch-hoặc-commit-cũ> && docker compose up -d --build app
# Migration additive → thường không cần rollback DB. Nếu cần:
cat backup-truoc-nang-cap-*.sql | docker exec -i zalo-crm-db psql -U crmuser zalocrm
```

---

## 9. Sự cố thường gặp

| Triệu chứng | Xử lý |
|---|---|
| Route core trả 404 hết / app không lên | xem `docker logs zalo-crm-app`; kiểm `migrate deploy` đã chạy + `migrate status` "up to date" |
| Boot đầu log `... does not exist` | transient trước `migrate deploy`; sau migrate + `restart app` hết |
| `clamav/clamav:1.3 not found` | clamav/backup tuỳ chọn — chỉ `up ... app db redis minio minio-init` |
| Lỡ thấy menu Automation/Lead Pool | đang chạy nhầm **bản EE** (image còn `_ee`). Kiểm `docker logs ... | grep edition` phải là *Community* |
| Ảnh chat không hiển thị | `S3_PUBLIC_URL` chưa HTTPS công khai / chưa thêm hostname `fileoss...` trên tunnel (§5) |
| Muốn dùng Automation/Lead Pool/FB | đó là tính năng **Extension** — chuyển sang bản EE (xem guide EE) |

---

### Phụ lục — đối chiếu nhanh EE ↔ Community
| | EE | Community |
|---|---|---|
| Log boot | `Extension edition — _ee bundle loaded` | `Community edition — _ee bundle absent` |
| `/api/v1/automation/triggers` | 401 | **404** |
| `/api/v1/lead-pool/config` | 401 | **404** |
| Thư mục `_ee/` | có | không |
| Lệnh build/chạy/migrate | giống nhau | giống nhau |
