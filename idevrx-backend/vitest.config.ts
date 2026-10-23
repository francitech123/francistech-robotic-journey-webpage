import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000, // the first run downloads a MongoDB binary
    env: {
      MONGODB_URI: "mongodb://unused",
      JWT_SECRET: "test-secret-test-secret-test-secret-1234",
      CREATOR_AUTO_APPROVE: "true",
      REQUIRE_VERIFIED_EMAIL: "false",
      S3_BUCKET: "test",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
    },
  },
});
