import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function UploadPage() {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [shop, setShop] = useState<"Japan Stationery" | "Elite Camp">("Japan Stationery");
  // Payload of an upload blocked by the date-overlap guard, kept so "Import Anyway" can retry it
  const [pendingOverlap, setPendingOverlap] = useState<{
    fileData: string; fileName: string; mimeType: string; shop: "Japan Stationery" | "Elite Camp"; message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const uploadedFiles = trpc.upload.getUploadedFiles.useQuery(undefined, {
    enabled: !!user && user.role === "admin",
  });

  const importMutation = trpc.upload.importExcelFile.useMutation({
    onSuccess: (data, variables) => {
      setUploading(false);
      if (data.success) {
        setPendingOverlap(null);
        setUploadStatus({ success: true, message: data.message });
        toast.success(data.message);
        utils.upload.getUploadedFiles.invalidate();
      } else if ((data as any).overlap) {
        // Blocked by the duplicate-range guard — offer an explicit override
        setPendingOverlap({
          fileData: variables.fileData,
          fileName: variables.fileName,
          mimeType: variables.mimeType,
          shop: variables.shop,
          message: data.message,
        });
        setUploadStatus(null);
        utils.upload.getUploadedFiles.invalidate();
      } else {
        setUploadStatus({ success: false, message: data.message });
        toast.error(data.message);
      }
    },
    onError: (error) => {
      setUploading(false);
      setUploadStatus({ success: false, message: error.message });
      toast.error("Import failed: " + error.message);
    },
  });

  const confirmOverlapImport = () => {
    if (!pendingOverlap) return;
    setUploading(true);
    const { message, ...payload } = pendingOverlap;
    setPendingOverlap(null);
    importMutation.mutate({ ...payload, allowOverlap: true });
  };

  const handleFile = async (file: File) => {
    // Validate file type
    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (!validTypes.includes(file.type) && !file.name.endsWith(".xlsx")) {
      toast.error("Please upload an Excel file (.xlsx)");
      return;
    }

    setUploading(true);
    setUploadStatus(null);
    setPendingOverlap(null);

    try {
      // Read file as base64
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      importMutation.mutate({
        fileData: base64,
        fileName: file.name,
        mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        shop,
      });
    } catch (error) {
      setUploading(false);
      toast.error("Failed to read file");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Upload Data</h1>
        <Card className="border-border/60">
          <CardContent className="p-8 flex flex-col items-center justify-center">
            <AlertCircle className="h-12 w-12 text-amber-500 mb-4" />
            <h2 className="text-lg font-semibold text-slate-800">Admin Access Required</h2>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              Only authenticated administrators can upload and import sales data files.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-MY", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Upload Data</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload new Shopee or Lazada Excel files to import fresh sales data
        </p>
      </div>

      {/* Upload Area */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">Upload Excel File</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Shop selector */}
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Shop:</label>
            <Select value={shop} onValueChange={(v) => setShop(v as "Japan Stationery" | "Elite Camp")}>
              <SelectTrigger className="w-48 h-9 text-sm">
                <SelectValue placeholder="Select shop" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Japan Stationery">Japan Stationery</SelectItem>
                <SelectItem value="Elite Camp">Elite Camp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragOver
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <FileSpreadsheet className={`h-10 w-10 mx-auto mb-3 ${dragOver ? "text-indigo-500" : "text-slate-400"}`} />
            <p className="text-sm font-medium text-slate-700 mb-1">
              Drop your Excel file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Supported: Shopee Order.all.*.xlsx or Lazada compiled .xlsx files
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <UploadIcon className="h-4 w-4 mr-2" />
              Select File
            </Button>
          </div>

          {uploading && (
            <div className="mt-4 flex items-center gap-2 text-sm text-indigo-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Importing file, this may take a moment...</span>
            </div>
          )}

          {uploadStatus && (
            <div className={`mt-4 flex items-center gap-2 text-sm ${uploadStatus.success ? "text-emerald-600" : "text-red-600"}`}>
              {uploadStatus.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <span>{uploadStatus.message}</span>
            </div>
          )}

          {pendingOverlap && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-2 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Possible duplicate data</p>
                  <p className="mt-1">{pendingOverlap.message}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={confirmOverlapImport}
                  disabled={uploading}
                  className="h-8 bg-amber-600 hover:bg-amber-700 text-white text-xs"
                >
                  Import Anyway
                </Button>
                <Button
                  onClick={() => setPendingOverlap(null)}
                  variant="outline"
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload History */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">Upload History</CardTitle>
        </CardHeader>
        <CardContent>
          {uploadedFiles.isLoading ? (
            <div className="h-20 animate-pulse bg-slate-100 rounded-lg" />
          ) : uploadedFiles.data?.length ? (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50">
                    <TableHead className="font-semibold text-xs text-slate-600">Filename</TableHead>
                    <TableHead className="font-semibold text-xs text-slate-600">Shop</TableHead>
                    <TableHead className="font-semibold text-xs text-slate-600">Size</TableHead>
                    <TableHead className="font-semibold text-xs text-slate-600">Status</TableHead>
                    <TableHead className="font-semibold text-xs text-slate-600">Orders</TableHead>
                    <TableHead className="font-semibold text-xs text-slate-600">Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadedFiles.data.map((file: any) => (
                    <TableRow key={file.id} className="hover:bg-slate-50/50">
                      <TableCell className="text-xs">
                        <div className="font-medium text-slate-800 truncate max-w-[200px]" title={file.originalName}>
                          {file.originalName}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{file.shop || "Japan Stationery"}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {file.fileSize > 1024 * 1024
                          ? `${(file.fileSize / 1024 / 1024).toFixed(1)} MB`
                          : `${(file.fileSize / 1024).toFixed(0)} KB`}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                          file.importStatus === "imported" ? "text-emerald-600" :
                          file.importStatus === "failed" ? "text-red-600" :
                          file.importStatus === "importing" ? "text-amber-600" :
                          "text-slate-500"
                        }`}>
                          {file.importStatus === "imported" && <CheckCircle2 className="h-3 w-3" />}
                          {file.importStatus === "failed" && <AlertCircle className="h-3 w-3" />}
                          {file.importStatus === "importing" && <Loader2 className="h-3 w-3 animate-spin" />}
                          {file.importStatus}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{file.ordersImported?.toLocaleString() || 0}</TableCell>
                      <TableCell className="text-xs text-slate-500">{formatDate(file.uploadedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center text-muted-foreground text-sm">
              No files uploaded yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
