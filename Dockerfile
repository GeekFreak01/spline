# Spline as a website: spline --web :8080
# Build:  docker build --build-arg VERSION=v1.2.3 -t spline .
# Run:    see deploy/docker-compose.yml

FROM golang:alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/spline .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/spline /spline
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/spline", "--web", ":8080"]
