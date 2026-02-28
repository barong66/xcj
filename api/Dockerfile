# ── Stage 1: Build ────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Cache dependencies first
COPY go.mod go.sum* ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o /build/server ./cmd/server

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates wget tzdata

WORKDIR /app

COPY --from=builder /build/server /app/server

EXPOSE 8080

ENTRYPOINT ["/app/server"]
