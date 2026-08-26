import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// viewport-fit=cover is what makes env(safe-area-inset-*) resolve to anything
// other than 0px on notched iOS — without it every safe-area pad in the app is
// silently inert. No maximumScale/userScalable: pinch-zoom stays available.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: { default: 'Simbkit', template: 'Simbkit - %s' },
  description: 'Simbkit — an application starter.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <ToastContainer
          aria-label="Notifications"
          position="top-right"
          theme="dark"
          autoClose={4000}
          newestOnTop
        />
      </body>
    </html>
  );
}
