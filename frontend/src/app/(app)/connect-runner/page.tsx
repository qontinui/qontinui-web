"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ConnectRunnerRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/runners");
  }, [router]);

  return null;
}
