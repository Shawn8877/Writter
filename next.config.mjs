const nextConfig = {
  distDir: process.env.NOVELAI_TEST_MODE === "1" ? ".next-test" : ".next",
  devIndicators: false,
};

export default nextConfig;
