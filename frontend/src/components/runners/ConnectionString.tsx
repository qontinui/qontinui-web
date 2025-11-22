"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Download, QrCode } from "lucide-react"
import { toast } from "sonner"
import { QRCodeSVG } from "qrcode.react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface ConnectionStringProps {
  token: string;
  url: string;
  userId: string;
  projectId?: number | null;
  version?: string;
  className?: string;
  showQRCode?: boolean;
  showDownload?: boolean;
}

export function ConnectionString({
  token,
  url,
  userId,
  projectId,
  version = "1.0.0",
  className = "",
  showQRCode = true,
  showDownload = true,
}: ConnectionStringProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const connectionConfig = {
    version,
    url,
    token,
    userId,
    projectId,
    createdAt: new Date().toISOString(),
  };

  const connectionString = JSON.stringify(connectionConfig, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(connectionString);
      setCopied(true);
      toast.success('Connection string copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy connection string');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([connectionString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qontinui-runner-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Configuration file downloaded!');
  };

  return (
    <div className={className}>
      {/* Connection String Display */}
      <div className="relative">
        <pre className="bg-[#0A0A0B] border border-gray-700 rounded-lg p-4 text-sm overflow-x-auto max-h-80 overflow-y-auto">
          <code className="text-gray-300">{connectionString}</code>
        </pre>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mt-4">
        <Button
          onClick={handleCopy}
          className="flex-1 bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
        >
          {copied ? (
            <>Copied!</>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Copy Connection String
            </>
          )}
        </Button>

        {showDownload && (
          <Button
            onClick={handleDownload}
            variant="outline"
            className="border-gray-700 hover:bg-[#1A1A1B]"
          >
            <Download className="w-4 h-4 mr-2" />
            Download
          </Button>
        )}

        {showQRCode && (
          <Dialog open={qrOpen} onOpenChange={setQrOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="border-gray-700 hover:bg-[#1A1A1B]"
              >
                <QrCode className="w-4 h-4 mr-2" />
                QR Code
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#1A1A1B] border-gray-800">
              <DialogHeader>
                <DialogTitle>Scan QR Code</DialogTitle>
                <DialogDescription>
                  Scan this QR code with the desktop runner app to connect instantly
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-center py-6">
                <div className="bg-white p-4 rounded-lg">
                  <QRCodeSVG
                    value={connectionString}
                    size={256}
                    level="H"
                    includeMargin={true}
                  />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
