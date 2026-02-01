FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copy source code including go.mod
COPY . .

# Generate go.sum and download dependencies based on actual source imports
RUN go mod tidy

# Build the binary
RUN go build -o main .

# Runtime stage
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/main .

CMD ["./main"]
