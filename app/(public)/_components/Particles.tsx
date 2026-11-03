export function Particles() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {Array.from({ length: 24 }, (_, index) => (
        <span
          key={index}
          className="absolute h-1 w-1 animate-float rounded-full bg-white/30"
          style={{
            left: `${(index * 37) % 100}%`,
            top: `${(index * 53) % 100}%`,
            animationDuration: `${6 + (index % 5)}s`,
            animationDelay: `${index * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
