import { useEffect, useState } from 'react';
import type { DeviceClass, Platform } from '@skb/shared';

export interface DeviceInfo {
  deviceClass: DeviceClass;
  platform: Platform;
  width: number;
  isTouch: boolean;
  isPortrait: boolean;
}

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent;
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (/iPhone|iPod/.test(ua)) return 'ios';
  if (isIpad) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return 'macos';
  return 'web';
}

function classify(width: number): DeviceClass {
  if (width < 768) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

function read(): DeviceInfo {
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const height = typeof window === 'undefined' ? 800 : window.innerHeight;
  const isTouch =
    typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  return {
    deviceClass: classify(width),
    platform: detectPlatform(),
    width,
    isTouch,
    isPortrait: height >= width,
  };
}

/**
 * Maps viewport + platform hints to a device class. The adaptive shell renders:
 *   phone → bottom tab bar + sheets · tablet → nav rail · desktop/iPad → full sidebar.
 */
export function useDeviceInfo(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(read);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setInfo(read()));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      cancelAnimationFrame(frame);
    };
  }, []);
  return info;
}
