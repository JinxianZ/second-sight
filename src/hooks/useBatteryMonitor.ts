import { useEffect, useRef, useState } from 'react';

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  level: number;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

export interface BatteryStatus {
  supported: boolean;
  levelPercent: number | null;
  charging: boolean;
  isLow: boolean;
}

interface UseBatteryMonitorOptions {
  threshold?: number;
  onLowBattery: () => void;
}

export function useBatteryMonitor({
  threshold = 0.15,
  onLowBattery,
}: UseBatteryMonitorOptions): BatteryStatus {
  const [status, setStatus] = useState<BatteryStatus>({
    supported: false,
    levelPercent: null,
    charging: false,
    isLow: false,
  });

  const announcedRef = useRef(false);
  const onLowBatteryRef = useRef(onLowBattery);
  onLowBatteryRef.current = onLowBattery;

  useEffect(() => {
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      return;
    }

    let cancelled = false;
    let batteryRef: BatteryManagerLike | null = null;

    const handleUpdate = () => {
      if (cancelled || !batteryRef) return;
      const level = batteryRef.level;
      const charging = batteryRef.charging;
      const isLow = level < threshold && !charging;

      setStatus({
        supported: true,
        levelPercent: Math.round(level * 100),
        charging,
        isLow,
      });

      if (isLow && !announcedRef.current) {
        announcedRef.current = true;
        onLowBatteryRef.current();
      }
    };

    nav
      .getBattery()
      .then((battery) => {
        if (cancelled) return;
        batteryRef = battery;
        handleUpdate();
        battery.addEventListener('levelchange', handleUpdate);
        battery.addEventListener('chargingchange', handleUpdate);
      })
      .catch(() => {
        // Ignore Battery Status API errors on restricted contexts
      });

    return () => {
      cancelled = true;
      if (batteryRef) {
        batteryRef.removeEventListener('levelchange', handleUpdate);
        batteryRef.removeEventListener('chargingchange', handleUpdate);
      }
    };
  }, [threshold]);

  return status;
}
