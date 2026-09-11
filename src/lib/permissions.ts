import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type PermissionState = {
  loading: boolean;
  signedIn: boolean;
  staffName: string | null;
  isPlatformAdmin: boolean;
  can: (key: string) => boolean;
};

async function fetchMyPermissions() {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const { data, error } = await supabase.rpc("staff_my_permissions");
  if (error) throw error;
  const rows = (data ?? []) as {
    staff_name: string;
    is_platform_admin: boolean;
    permission_key: string;
  }[];
  return {
    staffName: rows[0]?.staff_name ?? null,
    isPlatformAdmin: rows[0]?.is_platform_admin ?? false,
    keys: new Set(rows.map((r) => r.permission_key)),
  };
}

/** Fetches the signed-in staff member's permission set once and exposes a can(key) helper. */
export function usePermissions(): PermissionState {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [keys, setKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchMyPermissions()
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setSignedIn(false);
        } else {
          setSignedIn(true);
          setStaffName(result.staffName);
          setIsPlatformAdmin(result.isPlatformAdmin);
          setKeys(result.keys);
        }
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function can(key: string) {
    return isPlatformAdmin || keys.has(key);
  }

  return { loading, signedIn, staffName, isPlatformAdmin, can };
}
