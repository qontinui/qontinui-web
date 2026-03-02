export function PackageLoadingState() {
  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Loading package details...</p>
      </div>
    </div>
  );
}
