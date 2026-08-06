'use client';

import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Clock,
  Cpu,
  FileText,
  Folder,
  GitBranch,
  Globe,
  HelpCircle,
  Icon,
  Instagram,
  Laptop,
  Layers,
  LayoutGrid,
  Linkedin,
  Mail,
  Mic,
  Moon,
  Phone,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Twitter,
  Upload,
  Video,
  Wrench,
  Youtube,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';

// Partner / Enterprise logos as SVG components
function MazeLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 100 24">
      <text x="0" y="18" fontFamily="system-ui, sans-serif" fontSize="18" fontWeight="bold">maze</text>
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 90 24">
      <text x="0" y="19" fontFamily="system-ui, sans-serif" fontSize="20" fontWeight="600" letterSpacing="-0.5px">Google</text>
    </svg>
  );
}

function DocuSignLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 110 24">
      <text x="0" y="19" fontFamily="system-ui, sans-serif" fontSize="19" fontWeight="700">DocuSign</text>
    </svg>
  );
}

function NotionLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 95 24">
      <g transform="translate(0,2)">
        <rect x="2" y="2" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M7 6v8l6-8v8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <text x="25" y="15" fontFamily="system-ui, sans-serif" fontSize="18" fontWeight="700">Notion</text>
      </g>
    </svg>
  );
}

function StripeLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 80 24">
      <text x="0" y="19" fontFamily="system-ui, sans-serif" fontSize="22" fontWeight="800" letterSpacing="-1px">stripe</text>
    </svg>
  );
}

function SlackLogo() {
  return (
    <svg className="h-6 w-auto opacity-70 transition-opacity hover:opacity-100 fill-current" viewBox="0 0 85 24">
      <text x="0" y="18" fontFamily="system-ui, sans-serif" fontSize="19" fontWeight="700">slack</text>
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg className="size-4 fill-current" viewBox="0 0 24 24">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 1 1-5.2-1.74 2.89 2.89 0 0 1 2.31-1.42V9.01a6.34 6.34 0 0 0-5.1 6.22 6.34 6.34 0 1 0 10.74-4.54 8.27 8.27 0 0 0 4.47 1.34v-3.6a4.85 4.85 0 0 1-2.85-1.74z" />
    </svg>
  );
}

const NODES = [
  {
    id: 'TOPIC',
    name: 'Topic Selection',
    type: 'trigger',
    color: '#3dd68c',
    icon: Sparkles,
    desc: 'Deduplicated via embedding lookup against historical runs.',
    output: 'Topic: "Ancient Roman Engineering Secrets"',
  },
  {
    id: 'SCRIPT',
    name: 'Script Generation',
    type: 'ai',
    color: '#8b7bff',
    icon: Cpu,
    desc: 'LLM hook + body generator with strict length bounds.',
    output: 'Script: 142 words, 45 seconds total duration.',
  },
  {
    id: 'SCENES',
    name: 'Shot List Planner',
    type: 'logic',
    color: '#ffa24c',
    icon: Layers,
    desc: 'Splits narration into distinct timed camera scenes.',
    output: 'Scenes: 6 key visual stills planned.',
  },
  {
    id: 'AUDIO',
    name: 'Narration & Captions',
    type: 'media',
    color: '#4ca6ff',
    icon: Mic,
    desc: 'TTS blocks measured per word to ensure 0ms caption drift.',
    output: 'Audio: 6 WAV blocks + precise VTT subtitle timeline.',
  },
  {
    id: 'RENDER',
    name: 'FFmpeg Video Render',
    type: 'video',
    color: '#ff6b6b',
    icon: Video,
    desc: 'Composites 1080x1920 60FPS video, audio, and subtitles.',
    output: 'Render: final_output.mp4 (48.2 MB, 1080x1920).',
  },
  {
    id: 'UPLOAD',
    name: 'YouTube Publisher',
    type: 'upload',
    color: '#ff7ac6',
    icon: Upload,
    desc: 'Publishes via OAuth2, verifies metadata & clears temp files.',
    output: 'Status: Published to YouTube Shorts (ID: #v92kd81)',
  },
];

// Framer Motion Animation Variants
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
    },
  },
};

export default function Landing() {
  const [selectedNode, setSelectedNode] = useState(0);
  const [activeStep, setActiveStep] = useState(2);
  const [isAnnual, setIsAnnual] = useState(true);
  const [theme, setTheme] = useState<Theme>('dark');
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Initialize theme & detect window scroll for navbar glassmorphism
  useEffect(() => {
    setTheme(currentTheme());

    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  // Auto-advance active step animation in workflow showcase
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % NODES.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  const handleNewsletterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newsletterEmail) {
      setSubscribed(true);
      setTimeout(() => setSubscribed(false), 4000);
      setNewsletterEmail('');
    }
  };

  return (
    <main className="relative min-h-dvh overflow-x-hidden bg-void text-ink font-sans selection:bg-accent selection:text-on-accent transition-colors duration-300">
      {/* Background Arc / Orbital Graphics */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden opacity-35">
        <svg
          width="1200"
          height="650"
          viewBox="0 0 1200 650"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[1400px]"
        >
          <circle cx="600" cy="-100" r="320" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" />
          <circle cx="600" cy="-100" r="480" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" strokeDasharray="4 4" />
          <circle cx="600" cy="-100" r="620" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1.5" />
          <circle cx="280" cy="180" r="4" fill="#a594ff" className="animate-pulse" />
          <circle cx="920" cy="180" r="5" fill="#3dd68c" className="animate-pulse" />
          <circle cx="150" cy="380" r="6" fill="#ff7ac6" />
          <circle cx="1050" cy="380" r="4" fill="#ffa24c" />
        </svg>
      </div>

      {/* Floating Decorative Badges (Hero Orbit Icons) */}
      <div className="pointer-events-none absolute inset-x-0 top-16 mx-auto max-w-6xl px-6 h-[500px]">
        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute left-[6%] top-[14%] flex size-12 items-center justify-center rounded-2xl bg-accent/20 border border-accent/40 text-accent shadow-[0_0_25px_rgba(124,92,255,0.3)] backdrop-blur-md"
        >
          <Zap size={22} className="fill-current" />
        </motion.div>
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          className="absolute right-[6%] top-[22%] flex size-12 items-center justify-center rounded-2xl bg-[#0f8f56]/20 border border-[#3dd68c]/40 text-[#3dd68c] shadow-[0_0_25px_rgba(61,214,140,0.3)] backdrop-blur-md"
        >
          <Wrench size={20} />
        </motion.div>
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          className="absolute left-[3%] top-[50%] flex size-12 items-center justify-center rounded-2xl bg-[#ff7ac6]/20 border border-[#ff7ac6]/40 text-[#ff7ac6] shadow-[0_0_25px_rgba(255,122,198,0.3)] backdrop-blur-md"
        >
          <Sparkles size={20} />
        </motion.div>
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
          className="absolute right-[10%] top-[60%] flex size-12 items-center justify-center rounded-2xl bg-[#ffa24c]/20 border border-[#ffa24c]/40 text-[#ffa24c] shadow-[0_0_25px_rgba(255,162,76,0.3)] backdrop-blur-md"
        >
          <Folder size={20} />
        </motion.div>
      </div>

      {/* Fixed Animated Transparent Glassmorphism Header Navigation */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className={`fixed top-0 inset-x-0 z-50 border-b transition-all duration-300 ${
          scrolled
            ? 'py-3.5 border-white/10 bg-void/75 backdrop-blur-2xl shadow-xl shadow-accent/5'
            : 'py-4.5 border-white/6 bg-void/40 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-node-ai to-accent shadow-md shadow-accent/20 transition-transform group-hover:scale-105">
              <Clapperboard size={16} className="text-on-accent" strokeWidth={2.2} />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Yu-tomation</span>
          </Link>

          <nav className="hidden items-center gap-7 text-[12.5px] font-medium lg:flex">
            <a href="#product" className="text-dim transition-colors hover:text-ink">
              PRODUCT
            </a>
            <a href="#workflow" className="text-dim transition-colors hover:text-ink">
              WORKFLOW
            </a>
            <a href="#learning" className="text-dim transition-colors hover:text-ink">
              LEARNING
            </a>
            <a href="#featured" className="text-dim transition-colors hover:text-ink">
              FEATURED
            </a>
            <a href="#pricing" className="text-dim transition-colors hover:text-ink">
              PRICING
            </a>
            <a href="#resources" className="font-semibold text-accent-hi underline underline-offset-8 decoration-2 decoration-accent">
              RESOURCES
            </a>
          </nav>

          <div className="flex items-center gap-3">
            {/* Theme Toggle Button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="grid size-9 place-items-center rounded-full border border-white/10 bg-rise/80 text-dim transition-colors hover:bg-lift hover:text-ink"
            >
              {theme === 'dark' ? <Sun size={15} className="text-yellow-400" /> : <Moon size={15} className="text-accent" />}
            </motion.button>

            <Link
              href="/login"
              className="rounded-full border border-white/10 bg-rise/80 px-4 py-1.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-lift"
            >
              Login
            </Link>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Link
                href="/login"
                className="rounded-full bg-accent px-4.5 py-1.5 text-[12.5px] font-medium text-on-accent shadow-[0_4px_16px_rgba(124,92,255,0.4)] transition-all hover:bg-accent-hi hover:shadow-[0_6px_20px_rgba(124,92,255,0.6)]"
              >
                Get Started
              </Link>
            </motion.div>
          </div>
        </div>
      </motion.header>

      {/* Hero Section (Target Height: 90vh) */}
      <section className="relative z-10 mx-auto flex min-h-[90vh] max-w-4xl flex-col items-center justify-center px-6 pt-20 text-center">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="flex flex-col items-center"
        >
          <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1 text-[11.5px] font-semibold tracking-wider text-accent-hi">
            <span className="grid size-4 place-items-center rounded-full bg-accent text-on-accent">
              <Layers size={10} />
            </span>
            RESOURCES
          </motion.div>

          <motion.h1 variants={fadeInUp} className="mt-7 text-[clamp(40px,6.5vw,68px)] font-extrabold leading-[1.06] tracking-[-0.035em] text-balance">
            Learn, Build, and Automate with Confidence
          </motion.h1>

          <motion.p variants={fadeInUp} className="mx-auto mt-6 max-w-[62ch] text-[16px] leading-relaxed text-dim">
            Explore guides, documentation, and insights to help you design better workflows and get the most out of Yu-tomation.
          </motion.p>

          <motion.div variants={fadeInUp} className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="#resources"
              className="rounded-full border border-white/15 bg-rise/90 px-6 py-3 text-[13.5px] font-medium text-ink shadow-sm transition-all hover:border-white/25 hover:bg-lift"
            >
              Browse Resources
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="#workflow"
              className="rounded-full bg-accent px-6 py-3 text-[13.5px] font-medium text-on-accent shadow-[0_8px_28px_-6px_rgba(124,92,255,0.7)] transition-all hover:bg-accent-hi"
            >
              View Documentation
            </motion.a>
          </motion.div>
        </motion.div>
      </section>

      {/* Enterprise Logo Banner */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        id="product"
        className="relative z-10 border-y border-white/6 bg-sunk/50 py-10 backdrop-blur-sm"
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 lg:flex-row">
          <p className="max-w-[320px] text-center font-script text-[clamp(24px,2.8vw,32px)] font-bold leading-snug tracking-wide text-ink lg:text-left">
            Powering Automation Across Enterprise Teams
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 text-faint sm:gap-12">
            <MazeLogo />
            <GoogleLogo />
            <DocuSignLogo />
            <NotionLogo />
            <StripeLogo />
            <SlackLogo />
          </div>
        </div>
      </motion.section>

      {/* Explore Our Resources Section */}
      <section id="resources" className="relative z-10 mx-auto max-w-6xl px-6 pt-24 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between"
        >
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-hi">
              <Sparkles size={12} />
              CATEGORIES
            </div>
            <h2 className="mt-4 text-[clamp(32px,4vw,44px)] font-bold tracking-tight text-ink">
              Explore Our Resources
            </h2>
          </div>
          <p className="max-w-[440px] text-[14.5px] leading-relaxed text-dim">
            Find helpful materials designed to help teams learn automation, improve workflows, and build with Yu-tomation.
          </p>
        </motion.div>

        {/* 4 Showcase Cards Grid with Framer Motion Entrance */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
          className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4"
        >
          {/* Card 1: Dashboard UI Mockup */}
          <motion.div variants={fadeInUp} className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#6045dd]/90 via-[#37268d] to-rise p-6 shadow-xl transition-all duration-300 hover:border-accent/50">
            <div className="relative rounded-2xl border border-white/15 bg-sunk/80 p-4 backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-white/8 pb-3">
                <div className="flex items-center gap-2">
                  <div className="size-2.5 rounded-full bg-red-400/80" />
                  <div className="size-2.5 rounded-full bg-yellow-400/80" />
                  <div className="size-2.5 rounded-full bg-green-400/80" />
                </div>
                <span className="text-[10px] font-medium text-faint">Active Workflows</span>
              </div>
              <div className="mt-3 rounded-xl border border-white/6 bg-rise/60 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-dim">Workflows in Run</span>
                  <span className="text-[16px] font-bold text-accent-hi">57<span className="text-[11px] font-normal text-faint">/100</span></span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-lift">
                  <div className="h-full w-[57%] rounded-full bg-gradient-to-r from-accent to-node-trigger" />
                </div>
              </div>
              <div className="mt-3 space-y-2 text-[10.5px]">
                <div className="flex items-center justify-between rounded-lg border border-white/4 bg-void/50 px-2.5 py-1.5">
                  <span className="font-medium text-ink">Invoice Auto-regional</span>
                  <span className="rounded bg-node-trigger/20 px-1.5 py-0.5 font-semibold text-node-trigger">Active</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/4 bg-void/50 px-2.5 py-1.5">
                  <span className="font-medium text-ink">Payroll Processing</span>
                  <span className="rounded bg-node-ai/20 px-1.5 py-0.5 font-semibold text-node-ai">Running</span>
                </div>
              </div>
            </div>
            <div className="mt-6">
              <span className="inline-block rounded-full bg-accent/20 px-3 py-1 text-[11px] font-semibold text-accent-hi">
                Studio Platform
              </span>
              <h3 className="mt-3 text-[18px] font-bold text-ink">Visual Workflow Builder</h3>
              <p className="mt-1.5 text-[13px] text-dim">
                Build end-to-end AI pipelines with real-time state tracking and modular recovery.
              </p>
            </div>
          </motion.div>

          {/* Card 2: Guides & Tutorials */}
          <motion.div variants={fadeInUp} className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-rise/60 p-6 backdrop-blur-md transition-all hover:border-white/20">
            <div>
              <h3 className="text-[19px] font-bold text-ink">Guides & Tutorials</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                Step-by-step tutorials that help you build workflows and automate.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[12px] font-medium text-on-accent transition-all hover:bg-accent-hi"
              >
                Read Guides
              </Link>
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-br from-lift to-sunk p-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-white/6 pb-2 text-[10.5px] font-medium text-faint">
                <span>Tutorial Preview</span>
                <Sparkles size={12} className="text-accent-hi" />
              </div>
              <div className="mt-3 rounded-xl border border-white/8 bg-void/80 p-3">
                <p className="text-[11px] font-semibold text-ink">Describe the Automation</p>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 p-1.5 text-[10px] text-accent-hi">
                  <Play size={10} fill="currentColor" />
                  <span>Topic &rarr; Narration &rarr; Video</span>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Card 3: Interactive Workflows */}
          <motion.div variants={fadeInUp} className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#6025b6] via-[#481c96] to-[#2d0e65] p-6 shadow-xl text-[#ffffff]">
            <div className="space-y-3">
              <div className="rounded-xl border border-white/15 bg-sunk/80 p-3.5 shadow-md backdrop-blur-md">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#ffffff]">Interview Scheduling</span>
                  <span className="text-[9.5px] uppercase tracking-wider text-[#ffffff]">Event &middot; 0 Min</span>
                </div>
                <div className="mt-2.5 flex items-center justify-end">
                  <span className="rounded-full bg-[#ffffff]/20 px-2.5 py-0.5 text-[10px] font-semibold text-[#ffffff]">
                    See Preview
                  </span>
                </div>
              </div>

              <div className="relative rounded-xl border border-white/20 bg-accent/30 p-3.5 shadow-lg backdrop-blur-md">
                <span className="absolute -top-2 right-3 rounded-full bg-accent px-2 py-0.5 text-[9px] font-bold text-on-accent">
                  Complex
                </span>
                <div className="text-[11px] font-semibold text-[#ffffff]">Document Collection</div>
                <div className="mt-1 text-[9.5px] font-medium text-[#ffffff]">FORM &middot; 0 MIN</div>
                <div className="mt-2.5 flex items-center justify-end">
                  <span className="rounded-full bg-[#ffffff] px-2.5 py-0.5 text-[10px] font-semibold text-accent">
                    See Preview
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-sunk/60 p-2 text-center text-[10px] text-[#ffffff]">
                Standard Execution Engine
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-[19px] font-bold text-[#ffffff]">Interactive Workflows</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#ffffff]">
                Pre-built automation templates for instant deployment.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#ffffff] px-4 py-1.5 text-[12px] font-semibold text-accent transition-all hover:bg-[#ffffff]/90"
              >
                Build Workflows
              </Link>
            </div>
          </motion.div>

          {/* Card 4: Product Updates */}
          <motion.div variants={fadeInUp} className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-rise/60 p-6 backdrop-blur-md">
            <div>
              <h3 className="text-[19px] font-bold text-ink">Product Updates</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                Stay informed about new features, improvements, and updates.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[12px] font-medium text-on-accent transition-all hover:bg-accent-hi"
              >
                See Updates
              </Link>
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-gradient-to-br from-sunk to-lift p-4 shadow-lg">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-accent/20 p-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent">
                  <Cpu size={16} />
                </div>
                <div>
                  <p className="text-[11.5px] font-bold text-ink">Workflow</p>
                  <p className="text-[10px] text-dim">From scratch or template</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Learn Automation Step by Step Section */}
      <section id="learning" className="relative z-10 border-t border-white/6 bg-rise/30 py-24 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-hi">
              <BookOpen size={12} />
              LEARNING PATH
            </div>
            <h2 className="mt-4 text-[clamp(32px,4vw,44px)] font-bold tracking-tight text-ink">
              Learn Automation Step by Step
            </h2>
            <p className="mx-auto mt-3 max-w-[60ch] text-[15px] leading-relaxed text-dim">
              Follow structured learning paths designed to help individuals, agency owners, and enterprises build with Yu-tomation.
            </p>
          </motion.div>

          <div className="mt-16 space-y-16">
            {/* Step 1 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.6 }}
              className="grid grid-cols-1 items-center gap-10 rounded-3xl border border-white/10 bg-sunk/80 p-8 shadow-xl lg:grid-cols-2"
            >
              <div className="relative flex aspect-video items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-rise to-sunk p-8">
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex size-20 items-center justify-center rounded-3xl bg-accent text-on-accent shadow-2xl shadow-accent/40"
                >
                  <Rocket size={36} />
                </motion.div>
              </div>

              <div>
                <span className="mono text-[11px] font-bold tracking-widest text-accent-hi uppercase">Step 01</span>
                <h3 className="mt-2 text-[24px] font-bold text-ink">Getting Started with Yu-tomation</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-dim">
                  Learn how to set up your workspace, connect AI providers, configure topic sources, and trigger your first automated video generation pipeline.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 text-[13px] text-ink">
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Pipeline Basics</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Creating Runs</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">AI Nodes</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Step Recovery</span>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Step 2 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.6 }}
              className="grid grid-cols-1 items-center gap-10 rounded-3xl border border-white/10 bg-sunk/80 p-8 shadow-xl lg:grid-cols-2"
            >
              <div className="order-2 lg:order-1">
                <span className="mono text-[11px] font-bold tracking-widest text-accent-hi uppercase">Step 02</span>
                <h3 className="mt-2 text-[24px] font-bold text-ink">Workflow Design & Resilience</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-dim">
                  Master fault-tolerant node graph architectures. Ensure isolated step retries, word-measured narration sync, and clean temporary media disposal.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 text-[13px] text-ink">
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Fault Tolerance</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Audio Syncing</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Media Cleanup</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">JSON Schema</span>
                  </div>
                </div>
              </div>

              <div className="order-1 relative flex aspect-video items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-rise to-sunk p-8 lg:order-2">
                <motion.div
                  animate={{ rotate: [0, 5, 0, -5, 0] }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex size-20 items-center justify-center rounded-3xl bg-node-ai text-on-accent shadow-2xl shadow-node-ai/40"
                >
                  <GitBranch size={36} />
                </motion.div>
              </div>
            </motion.div>

            {/* Step 3 */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.6 }}
              className="grid grid-cols-1 items-center gap-10 rounded-3xl border border-white/10 bg-sunk/80 p-8 shadow-xl lg:grid-cols-2"
            >
              <div className="relative flex aspect-video items-center justify-center rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/20 via-rise to-sunk p-8">
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex size-20 items-center justify-center rounded-3xl bg-amber-500 text-on-accent shadow-2xl shadow-amber-500/40"
                >
                  <Clock size={36} />
                </motion.div>
              </div>

              <div>
                <span className="mono text-[11px] font-bold tracking-widest text-accent-hi uppercase">Step 03</span>
                <h3 className="mt-2 text-[24px] font-bold text-ink">Monitoring & Optimization</h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-dim">
                  Track live execution console logs, configure automated cron triggers, inspect media render buffers, and scale your channel automation.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-3 text-[13px] text-ink">
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Console Logs</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Auto-schedules</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Realtime Streams</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-rise/60 px-3.5 py-2.5">
                    <CheckCircle2 size={16} className="text-[#3dd68c]" />
                    <span className="font-medium">Performance Metrics</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Featured Resources Section */}
      <section id="featured" className="relative z-10 mx-auto max-w-6xl px-6 py-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-hi">
            <Sparkles size={12} />
            FEATURED
          </div>
          <h2 className="mt-4 text-[clamp(32px,4vw,44px)] font-bold tracking-tight text-ink">
            Featured Resources
          </h2>
          <p className="mx-auto mt-3 max-w-[55ch] text-[15px] leading-relaxed text-dim">
            Recommended resources to help you get started and improve your automation workflows.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
          className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3"
        >
          {/* Card 1 */}
          <motion.div variants={fadeInUp} className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-rise/60 p-6 backdrop-blur-md md:col-span-2 lg:col-span-1">
            <div>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-sunk/80 flex items-center justify-center p-6">
                <Laptop size={48} className="text-accent-hi opacity-80 group-hover:scale-110 transition-transform duration-300" />
              </div>
              <span className="mt-5 inline-block rounded-full bg-accent/20 px-3 py-1 text-[10.5px] font-bold text-accent-hi uppercase tracking-wider">
                BEGINNER GUIDE
              </span>
              <h3 className="mt-3 text-[20px] font-bold text-ink">Beginner&apos;s Guide to Workflow Automation</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
                Comprehensive step-by-step guide to building your first automated short-form video creation pipeline in Yu-tomation.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-[12.5px] font-medium text-on-accent transition-all hover:bg-accent-hi"
            >
              Read Guide <ArrowRight size={14} />
            </Link>
          </motion.div>

          {/* Card 2 */}
          <motion.div variants={fadeInUp} className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-rise/60 p-6 backdrop-blur-md">
            <div>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#3dd68c]/20 via-sunk to-rise flex items-center justify-center p-6">
                <ShieldCheck size={48} className="text-[#3dd68c] opacity-80 group-hover:scale-110 transition-transform duration-300" />
              </div>
              <h3 className="mt-5 text-[18px] font-bold text-ink">Building Reliable Automation Systems</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                Best practices for error handling, modular step retries, and schema validation across complex node graphs.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-hi hover:underline"
            >
              Learn More &rarr;
            </Link>
          </motion.div>

          {/* Card 3 */}
          <motion.div variants={fadeInUp} className="group flex flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-rise/60 p-6 backdrop-blur-md">
            <div>
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#ff7ac6]/20 via-sunk to-rise flex items-center justify-center p-6">
                <Share2 size={48} className="text-[#ff7ac6] opacity-80 group-hover:scale-110 transition-transform duration-300" />
              </div>
              <h3 className="mt-5 text-[18px] font-bold text-ink">Automation for Operations Teams</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                How media agencies and content teams automate batch publishing across multiple social channels seamlessly.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-6 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-hi hover:underline"
            >
              Learn More &rarr;
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* CTA Laptop Banner Section */}
      <motion.section
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="relative z-10 mx-auto max-w-6xl px-6 pb-28"
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-r from-accent via-[#6045dd] to-[#4f2fd0] p-10 md:p-14 shadow-2xl text-on-accent">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-block rounded-full bg-white/20 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                GET STARTED
              </span>
              <h2 className="mt-5 text-[clamp(30px,4.5vw,46px)] font-extrabold leading-[1.1] tracking-tight">
                See, Understand, and Trust Your Workflows
              </h2>
              <p className="mt-4 max-w-[45ch] text-[15.5px] leading-relaxed text-white/80">
                Experience full transparency into every step of your AI video generation pipeline on a unified canvas.
              </p>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="mt-8 inline-block">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[13.5px] font-bold text-accent shadow-xl transition-all hover:bg-white/90"
                >
                  Get Started Now <ArrowRight size={16} />
                </Link>
              </motion.div>
            </div>

            <div className="relative flex justify-center">
              <div className="w-full max-w-lg rounded-2xl border-4 border-white/20 bg-void/95 p-4 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <div className="flex gap-1.5">
                    <div className="size-2.5 rounded-full bg-red-400" />
                    <div className="size-2.5 rounded-full bg-yellow-400" />
                    <div className="size-2.5 rounded-full bg-green-400" />
                  </div>
                  <span className="mono text-[10px] text-faint">yu-tomation.studio</span>
                </div>
                <div className="mt-3 space-y-2 text-[11px]">
                  <div className="flex justify-between rounded-lg bg-rise p-2 text-ink">
                    <span>1. Topic Generation</span>
                    <span className="text-[#3dd68c]">OK</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-rise p-2 text-ink">
                    <span>2. Script & Narration</span>
                    <span className="text-[#3dd68c]">OK</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-rise p-2 text-ink">
                    <span>3. Shot List & Stills</span>
                    <span className="text-[#3dd68c]">OK</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-accent/20 p-2 text-accent-hi font-semibold">
                    <span>4. FFmpeg Video Render</span>
                    <span className="animate-pulse">RUNNING</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* Interactive Node Canvas Flow */}
      <section id="workflow" className="relative z-10 mx-auto max-w-6xl px-6 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#3dd68c]/30 bg-[#3dd68c]/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#3dd68c]">
            <Cpu size={12} />
            INTERACTIVE CANVAS ENGINE
          </div>
          <h2 className="mt-4 text-[clamp(32px,4vw,44px)] font-bold tracking-tight text-ink">
            Interactive Node Workflow Canvas
          </h2>
          <p className="mx-auto mt-3 max-w-[60ch] text-[15px] leading-relaxed text-dim">
            Watch real-time pipeline step execution with live progress moving along the edge paths. Click any node to inspect data contracts.
          </p>
        </motion.div>

        <div className="mt-12 rounded-3xl border border-white/10 bg-sunk/90 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="size-3 rounded-full bg-red-500/80" />
                <div className="size-3 rounded-full bg-yellow-500/80" />
                <div className="size-3 rounded-full bg-green-500/80" />
              </div>
              <span className="mono text-[11.5px] font-semibold text-dim">yu-pipeline-canvas-v2.flow</span>
            </div>
            <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-accent-hi bg-accent/15 px-3 py-1 rounded-full border border-accent/30">
              <span className="size-2 animate-pulse rounded-full bg-node-trigger" />
              Running Step {activeStep + 1} of {NODES.length}: {NODES[activeStep].name}
            </span>
          </div>

          <div className="relative mt-8 min-h-[380px] overflow-x-auto p-4">
            <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
              <defs>
                <linearGradient id="edge-active-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7c5cff" />
                  <stop offset="100%" stopColor="#3dd68c" />
                </linearGradient>
              </defs>
              <path
                d="M 170 80 C 230 80, 230 80, 290 80"
                fill="none"
                stroke={activeStep >= 1 ? 'url(#edge-active-grad)' : 'var(--canvas-edge)'}
                strokeWidth={activeStep >= 1 ? '2.5' : '1.5'}
                className={activeStep === 0 ? 'animate-flow-dash' : ''}
              />
              <path
                d="M 450 80 C 510 80, 510 80, 570 80"
                fill="none"
                stroke={activeStep >= 2 ? 'url(#edge-active-grad)' : 'var(--canvas-edge)'}
                strokeWidth={activeStep >= 2 ? '2.5' : '1.5'}
                className={activeStep === 1 ? 'animate-flow-dash' : ''}
              />
              <path
                d="M 730 80 C 820 80, 820 230, 730 230"
                fill="none"
                stroke={activeStep >= 3 ? 'url(#edge-active-grad)' : 'var(--canvas-edge)'}
                strokeWidth={activeStep >= 3 ? '2.5' : '1.5'}
                className={activeStep === 2 ? 'animate-flow-dash' : ''}
              />
              <path
                d="M 570 230 C 510 230, 510 230, 450 230"
                fill="none"
                stroke={activeStep >= 4 ? 'url(#edge-active-grad)' : 'var(--canvas-edge)'}
                strokeWidth={activeStep >= 4 ? '2.5' : '1.5'}
                className={activeStep === 3 ? 'animate-flow-dash' : ''}
              />
              <path
                d="M 290 230 C 230 230, 230 230, 170 230"
                fill="none"
                stroke={activeStep >= 5 ? 'url(#edge-active-grad)' : 'var(--canvas-edge)'}
                strokeWidth={activeStep >= 5 ? '2.5' : '1.5'}
                className={activeStep === 4 ? 'animate-flow-dash' : ''}
              />
            </svg>

            <div className="relative z-10 grid grid-cols-3 gap-y-24 gap-x-12 max-w-4xl mx-auto">
              {NODES.slice(0, 3).map((node, i) => {
                const isCurrent = activeStep === i;
                const isSelected = selectedNode === i;
                const NodeIcon = node.icon;
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNode(i)}
                    className={`group relative flex flex-col justify-between text-left rounded-2xl border p-4 transition-all duration-300 ${
                      isSelected
                        ? 'border-accent bg-rise shadow-[0_0_25px_rgba(124,92,255,0.35)] scale-105'
                        : isCurrent
                        ? 'border-[#3dd68c] bg-rise/90 shadow-[0_0_20px_rgba(61,214,140,0.25)]'
                        : 'border-white/10 bg-rise/50 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className="flex size-9 items-center justify-center rounded-xl text-on-accent shadow-md"
                        style={{ backgroundColor: node.color }}
                      >
                        <NodeIcon size={18} />
                      </div>
                      <span className="mono text-[10px] font-semibold text-faint">0{i + 1}</span>
                    </div>
                    <div className="mt-3">
                      <p className="text-[13px] font-bold text-ink">{node.name}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-dim">{node.desc}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2">
                      <span className="text-[10px] font-medium text-faint">
                        {isCurrent ? 'Executing…' : activeStep > i ? 'SUCCEEDED' : 'PENDING'}
                      </span>
                      {activeStep > i ? (
                        <CheckCircle2 size={13} className="text-[#3dd68c]" />
                      ) : isCurrent ? (
                        <span className="size-2 animate-ping rounded-full bg-[#3dd68c]" />
                      ) : null}
                    </div>
                  </button>
                );
              })}

              {NODES.slice(3, 6).reverse().map((node, revIdx) => {
                const i = 5 - revIdx;
                const isCurrent = activeStep === i;
                const isSelected = selectedNode === i;
                const NodeIcon = node.icon;
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNode(i)}
                    className={`group relative flex flex-col justify-between text-left rounded-2xl border p-4 transition-all duration-300 ${
                      isSelected
                        ? 'border-accent bg-rise shadow-[0_0_25px_rgba(124,92,255,0.35)] scale-105'
                        : isCurrent
                        ? 'border-[#3dd68c] bg-rise/90 shadow-[0_0_20px_rgba(61,214,140,0.25)]'
                        : 'border-white/10 bg-rise/50 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div
                        className="flex size-9 items-center justify-center rounded-xl text-on-accent shadow-md"
                        style={{ backgroundColor: node.color }}
                      >
                        <NodeIcon size={18} />
                      </div>
                      <span className="mono text-[10px] font-semibold text-faint">0{i + 1}</span>
                    </div>
                    <div className="mt-3">
                      <p className="text-[13px] font-bold text-ink">{node.name}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] text-dim">{node.desc}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-white/6 pt-2">
                      <span className="text-[10px] font-medium text-faint">
                        {isCurrent ? 'Executing…' : activeStep > i ? 'SUCCEEDED' : 'PENDING'}
                      </span>
                      {activeStep > i ? (
                        <CheckCircle2 size={13} className="text-[#3dd68c]" />
                      ) : isCurrent ? (
                        <span className="size-2 animate-ping rounded-full bg-[#3dd68c]" />
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-white/8 bg-void/90 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-accent-hi" />
                <span className="text-[12px] font-bold text-ink">Inspector Node Output: {NODES[selectedNode].name}</span>
              </div>
              <span className="mono text-[11px] text-faint">Node ID: {NODES[selectedNode].id}</span>
            </div>
            <p className="mt-2 mono text-[12px] text-accent-hi bg-rise/80 p-3 rounded-xl border border-white/6">
              &gt; {NODES[selectedNode].output}
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-6 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent-hi">
            <Sparkles size={12} />
            PRICING TIERS
          </div>
          <h2 className="mt-4 text-[clamp(32px,4vw,44px)] font-bold tracking-tight text-ink">
            Simple, Transparent Pricing
          </h2>
          <p className="mx-auto mt-3 max-w-[55ch] text-[15px] leading-relaxed text-dim">
            Choose the plan that fits your video automation workflow needs.
          </p>
          <div className="mt-8 inline-flex items-center rounded-full border border-white/10 bg-rise p-1">
            <button
              onClick={() => setIsAnnual(false)}
              className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors ${
                !isAnnual ? 'bg-accent text-on-accent' : 'text-dim hover:text-ink'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors ${
                isAnnual ? 'bg-accent text-on-accent' : 'text-dim hover:text-ink'
              }`}
            >
              Annual <span className="ml-1 text-[10px] opacity-80">(Save 20%)</span>
            </button>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          variants={staggerContainer}
          className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3"
        >
          {/* Card 1: Community */}
          <motion.div variants={fadeInUp} className="flex flex-col justify-between rounded-3xl border border-accent/20 bg-sunk/90 p-8 shadow-lg backdrop-blur-md transition-all hover:border-accent/40">
            <div>
              <h3 className="text-[20px] font-bold text-ink">Community</h3>
              <p className="mt-1 text-[13px] text-dim">For developers & creators testing automation.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-[40px] font-extrabold text-ink">$0</span>
                <span className="text-[13px] text-faint">/ forever</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-[13px] text-dim">
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>Single local workspace</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>Unlimited manual runs</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>FFmpeg local video rendering</span>
                </li>
              </ul>
            </div>
            <Link
              href="/login"
              className="mt-8 rounded-full border border-accent/30 bg-rise py-3 text-center text-[13px] font-semibold text-ink transition-all hover:border-accent hover:bg-lift"
            >
              Get Started Free
            </Link>
          </motion.div>

          {/* Card 2: Pro Studio (Vibrant Opero Purple Card) */}
          <motion.div variants={fadeInUp} className="relative flex flex-col justify-between rounded-3xl border-2 border-accent-hi bg-gradient-to-b from-[#6b38c2] via-[#5b25b6] to-[#451996] p-8 shadow-2xl shadow-accent/30 text-[#ffffff]">
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-[#ffffff] px-4 py-0.5 text-[10.5px] font-bold text-accent uppercase tracking-wider shadow-md">
              Most Popular
            </span>
            <div>
              <h3 className="text-[20px] font-bold text-[#ffffff]">Pro Studio</h3>
              <p className="mt-1 text-[13px] text-[#ffffff]">For content creators automating daily video channels.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-[40px] font-extrabold text-[#ffffff]">{isAnnual ? '$24' : '$29'}</span>
                <span className="text-[13px] text-[#ffffff]">/ month</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-[13px] text-[#ffffff]">
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#ffffff]" />
                  <span className="font-semibold text-[#ffffff]">Automated Cron Schedule runner</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#ffffff]" />
                  <span className="font-semibold text-[#ffffff]">Auto YouTube Shorts publishing</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#ffffff]" />
                  <span className="text-[#ffffff]">Cloud GPU accelerated render</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#ffffff]" />
                  <span className="text-[#ffffff]">Priority LLM & Voice API keys</span>
                </li>
              </ul>
            </div>
            <Link
              href="/login"
              className="mt-8 rounded-full bg-[#ffffff] py-3 text-center text-[13px] font-bold text-accent shadow-xl transition-all hover:bg-[#ffffff]/90 hover:scale-102"
            >
              Start 14-Day Free Trial
            </Link>
          </motion.div>

          {/* Card 3: Enterprise */}
          <motion.div variants={fadeInUp} className="flex flex-col justify-between rounded-3xl border border-accent/20 bg-sunk/90 p-8 shadow-lg backdrop-blur-md transition-all hover:border-accent/40">
            <div>
              <h3 className="text-[20px] font-bold text-ink">Enterprise</h3>
              <p className="mt-1 text-[13px] text-dim">For agencies & teams managing multi-channel automation.</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-[40px] font-extrabold text-ink">Custom</span>
              </div>
              <ul className="mt-8 space-y-3.5 text-[13px] text-dim">
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>Multi-workspace team access</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>Dedicated worker render nodes</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check size={16} className="text-[#3dd68c]" />
                  <span>Custom SLA & priority support</span>
                </li>
              </ul>
            </div>
            <Link
              href="/login"
              className="mt-8 rounded-full border border-accent/30 bg-rise py-3 text-center text-[13px] font-semibold text-ink transition-all hover:border-accent hover:bg-lift"
            >
              Contact Sales
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* Full Reference Footer */}
      <footer className="border-t border-white/8 bg-sunk/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 pt-16 pb-12">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
            <div className="col-span-2">
              <Link href="/" className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-node-ai to-accent shadow-md">
                  <Clapperboard size={16} className="text-on-accent" strokeWidth={2.2} />
                </span>
                <span className="text-[16px] font-bold tracking-tight">Yu-tomation</span>
              </Link>
              <p className="mt-4 max-w-[32ch] text-[13px] leading-relaxed text-dim">
                Fault-tolerant AI short-form video generation engine. Topic goes in, finished video comes out.
              </p>

              <div className="mt-4 space-y-2 text-[12.5px] text-dim">
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-accent-hi" />
                  <span>hello@yu-tomation.com</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-accent-hi" />
                  <span>+1 (800) 555-0199</span>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-ink">Product</p>
              <ul className="mt-4 space-y-2.5 text-[13px] text-dim">
                <li><a href="#product" className="hover:text-ink transition-colors">Overview</a></li>
                <li><a href="#workflow" className="hover:text-ink transition-colors">Canvas Engine</a></li>
                <li><a href="#learning" className="hover:text-ink transition-colors">Learning Path</a></li>
                <li><a href="#pricing" className="hover:text-ink transition-colors">Pricing</a></li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-ink">Use Cases</p>
              <ul className="mt-4 space-y-2.5 text-[13px] text-dim">
                <li><a href="#resources" className="hover:text-ink transition-colors">Content Creators</a></li>
                <li><a href="#resources" className="hover:text-ink transition-colors">Media Agencies</a></li>
                <li><a href="#resources" className="hover:text-ink transition-colors">Short-Form Channels</a></li>
                <li><a href="#resources" className="hover:text-ink transition-colors">Enterprise Teams</a></li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-bold uppercase tracking-wider text-ink">Resources</p>
              <ul className="mt-4 space-y-2.5 text-[13px] text-dim">
                <li><a href="#featured" className="hover:text-ink transition-colors">Documentation</a></li>
                <li><a href="#featured" className="hover:text-ink transition-colors">API Reference</a></li>
                <li><a href="#featured" className="hover:text-ink transition-colors">Community Guides</a></li>
                <li><a href="#featured" className="hover:text-ink transition-colors">Release Notes</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-14 flex flex-col justify-between gap-6 border-t border-white/6 pt-8 md:flex-row md:items-center">
            <div className="max-w-md">
              <p className="text-[13px] font-bold text-ink">Stay in the loop</p>
              <p className="mt-1 text-[12px] text-dim">Get the latest automation guides and product updates sent to your inbox.</p>
              <form onSubmit={handleNewsletterSubmit} className="mt-3 flex items-center gap-2">
                <input
                  type="email"
                  required
                  placeholder="Enter your email address"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  className="w-full rounded-full border border-white/10 bg-rise px-4 py-2 text-[12.5px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-full bg-accent px-4 py-2 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hi"
                >
                  {subscribed ? 'Subscribed!' : 'Subscribe'}
                </button>
              </form>
            </div>

            <div className="flex items-center gap-4 text-faint">
              <a href="https://twitter.com" target="_blank" rel="noreferrer" aria-label="Twitter" className="hover:text-ink transition-colors">
                <Twitter size={18} />
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="hover:text-ink transition-colors">
                <Linkedin size={18} />
              </a>
              <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram" className="hover:text-ink transition-colors">
                <Instagram size={18} />
              </a>
              <a href="https://youtube.com" target="_blank" rel="noreferrer" aria-label="YouTube" className="hover:text-ink transition-colors">
                <Youtube size={18} />
              </a>
              <a href="https://tiktok.com" target="_blank" rel="noreferrer" aria-label="TikTok" className="hover:text-ink transition-colors">
                <TikTokIcon />
              </a>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-white/6 pt-8 text-[12px] text-faint sm:flex-row">
            <p>&copy; {new Date().getFullYear()} Yu-tomation Inc. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <a href="#privacy" className="hover:text-ink transition-colors">Privacy Policy</a>
              <a href="#terms" className="hover:text-ink transition-colors">Terms of Service</a>
              <a href="#security" className="hover:text-ink transition-colors">Security</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
