import './globals.css';
import { Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import Providers from '@/components/Providers';
import Header from '@/components/Header';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata = {
  title: 'Polaris Protocol | Seamless Payment Integration',
  description: 'Integrate crypto payments with one line of code.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${jetBrainsMono.variable} bg-background text-foreground antialiased`}>
        <div className="scanline" />
        <Providers>
          <Header />
          <main className="pt-20">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
