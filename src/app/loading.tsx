export default function Loading() {
  return (
    <div className="flex-1 max-w-5xl w-full mx-auto p-4 animate-pulse space-y-3">
      <div className="h-6 w-48 rounded bg-gray-200" />
      <div className="h-72 rounded-xl bg-gray-100" />
    </div>
  );
}
