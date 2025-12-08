// Simple service that redraws image to canvas to strip EXIF orientation
// and ensure consistent processing.
export const angleDetectionService = {
  async autoCorrectRotation(file: File, onLog?: (msg: string) => void): Promise<File> {
    return new Promise((resolve, reject) => {
      onLog?.(`Auto-detecting text orientation (EXIF normalization)...`);
      
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        onLog?.(`Image loaded: ${img.width}x${img.height}`);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          URL.revokeObjectURL(url);
          onLog?.('Canvas context failed, skipping rotation');
          resolve(file); // Fallback
          return;
        }
        
        // This drawImage removes EXIF orientation on most modern browsers
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            onLog?.('Image orientation normalized');
            onLog?.('Image ready for OCR');
            const newFile = new File([blob], file.name, { type: 'image/jpeg' });
            resolve(newFile);
          } else {
            onLog?.('Blob creation failed, using original file');
            resolve(file); // Fallback
          }
        }, 'image/jpeg', 0.95);
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        onLog?.('Image load error, skipping rotation');
        resolve(file); // Fallback if image load fails
      };
      
      img.src = url;
    });
  }
};