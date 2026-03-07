package s3

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Client struct {
	mc        *minio.Client
	bucket    string
	publicURL string
}

func NewClient(endpoint, accessKey, secretKey, region, bucket, publicURL string) (*Client, error) {
	// Strip https:// prefix for minio-go (it uses secure flag instead).
	ep := strings.TrimPrefix(endpoint, "https://")
	ep = strings.TrimPrefix(ep, "http://")
	secure := strings.HasPrefix(endpoint, "https://")

	mc, err := minio.New(ep, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: secure,
		Region: region,
	})
	if err != nil {
		return nil, fmt.Errorf("s3: new client: %w", err)
	}

	return &Client{mc: mc, bucket: bucket, publicURL: strings.TrimRight(publicURL, "/")}, nil
}

// Upload puts an object into the bucket and returns its public URL with a cache-busting param.
func (c *Client) Upload(ctx context.Context, key string, data io.Reader, size int64, contentType string) (string, error) {
	_, err := c.mc.PutObject(ctx, c.bucket, key, data, size, minio.PutObjectOptions{
		ContentType: contentType,
		UserMetadata: map[string]string{
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	})
	if err != nil {
		return "", fmt.Errorf("s3: upload %s: %w", key, err)
	}

	url := fmt.Sprintf("%s/%s", c.publicURL, key)
	return url, nil
}
