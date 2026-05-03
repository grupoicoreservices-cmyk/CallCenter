import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

/**
 * Watches the backend's build hash every 60s. If it changes vs. the first
 * loaded version, shows a persistent toast asking the user to reload.
 * Uses a grace period (2 consecutive checks) to avoid false positives during
 * a rolling build where the index.html hash flips mid-swap.
 */
export default function VersionWatcher() {
  const initialBuild = useRef(null);
  const pendingNewBuild = useRef(null);
  const pendingCount = useRef(0);
  const toastShown = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { data } = await api.get("/system/version");
        const current = data.build;
        if (!initialBuild.current) {
          initialBuild.current = current;
          return;
        }
        if (current && current !== initialBuild.current) {
          // Require 2 consecutive observations of the SAME new build
          // to avoid false positives during the atomic swap (build.new → build)
          if (pendingNewBuild.current === current) {
            pendingCount.current += 1;
          } else {
            pendingNewBuild.current = current;
            pendingCount.current = 1;
          }
          if (pendingCount.current >= 2 && !toastShown.current) {
            toastShown.current = true;
            toast.success("Nova versão detectada", {
              description: "Uma atualização foi aplicada. Clique para recarregar.",
              duration: Infinity,
              action: {
                label: "Recarregar",
                onClick: () => {
                  // Force cache bypass
                  const url = new URL(window.location.href);
                  url.searchParams.set("_v", Date.now());
                  window.location.replace(url.toString());
                },
              },
              icon: <RefreshCw size={16} />,
            });
            setTick((t) => t + 1);
          }
        } else {
          // same build, reset pending
          pendingNewBuild.current = null;
          pendingCount.current = 0;
        }
      } catch (e) {
        // ignore (backend pode estar reiniciando)
      }
    }
    check();
    const id = setInterval(() => { if (!cancelled) check(); }, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return null;
}
