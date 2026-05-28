/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    if (dev) {
      // Windows 환경에서 간헐적인 HMR/CSS 누락(청크 불일치) 문제를 줄이기 위해
      // 감시를 polling 기반으로 고정하고, dev 캐시를 비활성화합니다.
      config.cache = false;
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        poll: 1000,
        aggregateTimeout: 300,
        // IMPORTANT:
        // - watchpack의 ignored는 "glob 문자열"이 아니라 RegExp로 주는 게 안전합니다.
        // - Windows에서 "System Volume Information" 폴더가 초기 스캔에서 EINVAL/예외를 유발할 수 있어 제외합니다.
        ignored:
          /([\\/](DumpStack\.log\.tmp|hiberfil\.sys|pagefile\.sys|swapfile\.sys)$)|([\\/]System Volume Information([\\/].*)?$)/,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
