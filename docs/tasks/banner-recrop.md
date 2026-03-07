# Banner Re-crop (Manual Crop in Admin Panel)

> Date: 2026-03-07
> Status: Done
> ClickUp: https://app.clickup.com/t/869ccz9yr

## Goal

Allow admins to manually re-crop banners through a visual crop editor in the admin panel, instead of relying solely on the automated OpenCV smart crop. This enables fine-tuning of banner composition when the automated crop misses the ideal framing.

## Problem

The automated banner generation uses OpenCV Haar cascade for face-aware smart crop, which works well in most cases but sometimes produces suboptimal results -- e.g. cutting off important parts of the image, centering on the wrong face, or not including enough context. There was no way to manually adjust the crop without re-running the entire banner generation pipeline.

## Solution

### Frontend: Visual crop editor
- **react-easy-crop** library for drag-and-zoom crop interface
- Crop modal opens from a crop icon on each banner card in the Promo tab
- Aspect ratio is locked to match the banner's dimensions (e.g. 300x250)
- Source image displayed at full resolution for precise cropping
- Zoom slider for fine-tuning the crop area
- On submit, pixel coordinates (x, y, width, height) are sent to the API

### Backend: RecropBanner handler
- New endpoint: `POST /api/v1/admin/banners/{id}/recrop`
- Request body: `{ x, y, width, height }` (pixel coordinates in the source image)
- Response: `{ image_url: "https://media.temptguide.com/banners/..." }`

**Handler flow:**
1. Look up banner by ID to get dimensions and source image URL
2. Source image resolution:
   - If `video_frame_id IS NOT NULL` -- use `video_frames.image_url` (extracted frame)
   - If `video_frame_id IS NULL` -- use `videos.thumbnail_lg_url` (original thumbnail)
3. Download source image via HTTP
4. Decode image, apply crop (SubImage with the provided rect)
5. Resize cropped area to banner dimensions using CatmullRom interpolation
6. Encode as JPEG (quality 90)
7. Upload to R2 via new S3 client package
8. Update `banners.image_url` in database
9. Return new public URL

### New S3 client package (api/internal/s3/client.go)
- Go package for R2/S3 uploads from the API server
- Uses `aws-sdk-go-v2` with S3-compatible endpoint configuration
- Initialized from environment variables: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_PUBLIC_URL
- Method: `Upload(ctx, key, body, contentType) -> publicURL`
- Uploads with `public-read` ACL and specified content type

### AdminBanner model update
- New field `source_image_url` added to the AdminBanner struct and API response
- Resolved server-side from video_frames or videos table based on video_frame_id
- Frontend uses this URL to display the source image in the crop modal

## API

### POST /api/v1/admin/banners/{id}/recrop

**Request:**
```json
{
  "x": 100,
  "y": 50,
  "width": 600,
  "height": 500
}
```

**Response:**
```json
{
  "image_url": "https://media.temptguide.com/banners/42/123_300x250.jpg"
}
```

**Errors:**
- 404: Banner not found
- 400: Invalid crop coordinates (out of bounds or zero dimensions)
- 500: Failed to download source, crop, or upload

## Environment Variables (Go API)

| Variable | Description |
|----------|-------------|
| S3_ENDPOINT | R2/S3 endpoint URL |
| S3_BUCKET | Bucket name (xcj-media) |
| S3_ACCESS_KEY | Access key |
| S3_SECRET_KEY | Secret key |
| S3_REGION | Region (auto for R2) |
| S3_PUBLIC_URL | Public CDN URL prefix (https://media.temptguide.com) |

## Files Changed

### New files
- `api/internal/s3/client.go` -- S3/R2 client package for Go API

### API (Go)
- `api/internal/handler/admin.go` -- RecropBanner handler
- `api/internal/store/admin_store.go` -- GetBannerForRecrop query (fetches banner + source_image_url), UpdateBannerImageURL, source_image_url in AdminBanner model
- `api/internal/handler/router.go` -- route registration for POST /admin/banners/{id}/recrop
- `api/cmd/server/main.go` -- S3 client initialization and injection
- `api/go.mod` / `api/go.sum` -- aws-sdk-go-v2 dependencies

### Frontend (Next.js)
- `web/src/lib/admin-api.ts` -- recropBanner API function
- `web/src/app/admin/accounts/[id]/page.tsx` -- crop modal UI with react-easy-crop, crop button on banner cards

### Infrastructure
- `deploy/docker/docker-compose.yml` -- S3 environment variables passed to API container

## How It Works

### User flow
```
Admin opens /admin/accounts/{id} -> Promo tab
-> Sees grid of banner cards
-> Clicks crop icon on a banner card
-> Modal opens with source image + crop overlay
-> Drags/zooms to select desired area (aspect ratio locked)
-> Clicks "Save Crop"
-> POST /admin/banners/{id}/recrop with crop coordinates
-> Server crops, resizes, uploads, returns new URL
-> Banner card updates with new image
```

### Source image resolution
```
Banner lookup:
  video_frame_id IS NOT NULL -> source = video_frames.image_url (extracted frame)
  video_frame_id IS NULL     -> source = videos.thumbnail_lg_url (original thumbnail)
```
