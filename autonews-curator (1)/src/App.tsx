
import React, { useState, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { useDropzone } from 'react-dropzone';
import { 
  FileText, 
  Upload, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  FileSpreadsheet,
  Trash2,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Sliders,
  List,
  Copy,
  Check,
  Sparkles,
  Calendar,
  MessageSquare,
  Plus,
  RefreshCw,
  Notebook,
  Edit,
  Clock,
  Wrench,
  UploadCloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { curateNews, summarizeRawText, robustFetch } from '@/lib/gemini';
import { parseFile } from '@/lib/file-parsers';
import { exportToExcel } from '@/lib/excel-utils';
import { extractDetailedNews, generateAndDownloadWordDoc, generateAndDownloadSummaryWordDoc } from '@/lib/word-utils';
import { detectFileDate, formatToDMMM } from '@/lib/date-utils';
import { NewsItem, CurationResult } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { cn, applyStrictSOPCleaning, formatToDDMMMYYYY_Spaced, formatSourceName } from '@/lib/utils';

const categoriesSOP = [
  "Corporate",
  "Electrification",
  "New Product",
  "Auto Ancillary",
  "Service",
  "Govt",
  "Global"
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [imageInlineData, setImageInlineData] = useState<{ data: string; mimeType: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [parsingFile, setParsingFile] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CurationResult | null>(null);
  const [rawUploadedText, setRawUploadedText] = useState<string>('');
  const [compilingWord, setCompilingWord] = useState(false);

  // Navigation & Summarization Features
  const [activeView, setActiveView] = useState<'curate' | 'summarize' | 'weekly'>('weekly');

  // Weekly Draft, Progress Tracker, and Collation Board Storage
  const [weeklyNews, setWeeklyNews] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('autocuration_weekly_news');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map(item => {
            if (item && typeof item.news === 'string' && item.news.startsWith("Global - ")) {
              return { ...item, news: item.news.replace(/^Global - /, "") };
            }
            return item;
          });
        }
        return parsed;
      }
      
      const initialPresets = [
        {
          id: "init-preset-1",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Auto Ancillary",
          news: "NBC Bearings launches its new automotive parts range in push to expand aftermarket portfolio",
          fullText: "National Engineering Industries Ltd (NEI), manufacturer of the NBC Bearings brand, has officially launched its new automotive parts range in India. This move is part of the company's aggressive strategy to expand its aftermarket portfolio, offering high-quality, reliable components including hub bearings, seals, and related parts to meet growing aftermarket demand across commercial and passenger vehicle segments.",
          sourceLink: "https://www.nbcbearings.com/news-media/nbc-bearings-launches-new-automotive-parts-range",
          isEV: false,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-2",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Auto Ancillary",
          news: "German car parts company Webasto plans to take local unit public",
          fullText: "Webasto, the leading German automotive supplier known for roof systems and heating solutions, is planning to take its local Indian business unit public. This initial public offering (IPO) aims to fuel the company's manufacturing expansion in India, capitalising on the rising popularity of sunroofs and high-tech automotive components in passenger cars.",
          sourceLink: "https://www.webasto-group.com/en/press-media/webasto-plans-ipo-indian-unit",
          isEV: false,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-3",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Electrification",
          news: "Tesla opens first destination charging station in North India at Delhi mall",
          fullText: "Tesla has marked a milestone in India by opening its first destination charging station in North India at a premium shopping mall in Delhi. This destination charger provides convenient AC charging for electric vehicles and serves as a precursor to Tesla's broader charging infrastructure and product entry into the Indian market.",
          sourceLink: "https://www.tesla.com/findus/destination-charging-north-india-delhi",
          isEV: true,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-4",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Service",
          news: "Bharat Petroleum to expand retail offerings, EV charging network",
          fullText: "Bharat Petroleum Corporation Limited (BPCL) has announced a major investment plan to expand its retail fuel station offerings and EV fast-charging network. The state-run oil marketing company plans to convert major highway corridors into clean energy corridors, installing thousands of EV chargers to support long-distance electric mobility.",
          sourceLink: "https://www.bharatpetroleum.in/about-bpcl/news-media/bpcl-expands-ev-charging",
          isEV: true,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-5",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Global",
          news: "Micron, Ford sign semiconductor supply agreement for vehicles",
          fullText: "Micron Technology and Ford Motor Company have signed a long-term semiconductor supply agreement to secure memory and storage solutions for Ford's next-generation connected and electric vehicles. This direct partnership highlights the growing integration between tech firms and global automakers to stabilize chip supply chains.",
          sourceLink: "https://www.micron.com/about/news-and-events/press-releases/micron-ford-agreement",
          isEV: true,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-6",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Corporate",
          news: "Spinny, JSW MG Motor partner to boost pre-owned EV market",
          fullText: "JSW MG Motor India has announced a strategic partnership with used-car platform Spinny to boost the pre-owned electric vehicle market in India. Under this partnership, the companies will offer certified pre-owned MG EVs with comprehensive checks, reliable warranty packages, and attractive resale values to encourage faster EV adoption.",
          sourceLink: "https://www.mgmotor.co.in/media-center/news-and-updates/mg-partners-with-spinny-preowned-ev",
          isEV: true,
          side: "r" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-7",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Corporate",
          news: "Suzuki-backed Next Bharat Ventures announces ₹2,000-cr impact fund",
          fullText: "Next Bharat Ventures, an investment initiative backed by Suzuki Motor Corporation, has announced a Rs 2,000-crore impact fund focused on supporting Indian startups working in social impact, agriculture, rural development, and clean mobility. The fund seeks to nurture innovations that improve quality of life and create sustainable livelihoods across India.",
          sourceLink: "https://www.globalsuzuki.com/globalnews/next-bharat-impact-fund",
          isEV: true,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-8",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Govt",
          news: "Amit Shah announces cooperative life insurance company; Bharat Taxi to expand to 500 cities",
          fullText: "Union Home and Cooperation Minister Amit Shah has announced the formation of a national cooperative life insurance company. Simultaneously, digital ride-hailing platform Bharat Taxi has announced plans to aggressively expand its outstation and local car rental services to 500 cities across India, strengthening tourist and B2B transit networks.",
          sourceLink: "https://www.bharattaxi.com/blog/bharat-taxi-expansion-500-cities",
          isEV: false,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-9",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Corporate",
          news: "Ashok Leyland partners with Rosmerta Recycling to drive responsible commercial vehicle scrappage",
          fullText: "Ashok Leyland, one of India's leading commercial vehicle manufacturers, has signed a Memorandum of Understanding (MoU) with Rosmerta Recycling to facilitate responsible and eco-friendly scrapping of end-of-life commercial vehicles. The partnership supports the government's vehicle scrappage policy by establishing high-efficiency recycling units.",
          sourceLink: "https://www.ashokleyland.com/en/news-media/ashok-leyland-partners-rosmerta-scrappage",
          isEV: false,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-10",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "New Product",
          news: "Piaggio launches Apé WavE electric three-wheeler at ₹2.49 lakh",
          fullText: "Piaggio Vehicles Pvt Ltd has introduced the new Apé WavE electric three-wheeler in India, priced at Rs 2.49 lakh (ex-showroom). Engineered for last-mile logistics and cargo transport, the new EV features a high-performance battery, low operational cost, and enhanced load capacity to drive commercial fleet electrification.",
          sourceLink: "https://www.piaggio-cv.co.in/news-releases/piaggio-launches-ape-wave-electric",
          isEV: true,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-11",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "New Product",
          news: "Mahindra Tractors launches YuvoTech+ 585 DI V1 pan-India",
          fullText: "Mahindra & Mahindra's Farm Equipment Sector has launched the Mahindra YuvoTech+ 585 DI V1 tractor across India. Designed for high efficiency and versatility in agricultural operations, the new tractor model features a powerful engine, advanced hydraulics, and precision settings to maximize crop yield and operational ease.",
          sourceLink: "https://www.mahindratractor.com/news-updates/mahindra-launches-yuvotech-plus",
          isEV: false,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-12",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "Service",
          news: "Goa govt launches booking app for iconic motorcycle taxi service",
          fullText: "The Goa Government has officially launched a digital booking app for the state's iconic motorcycle taxi operators, popularly known as 'pilots'. The app aims to bring digital convenience, standardized fare structures, and safety standards to this unique local heritage transit service, benefiting tourists and residents alike.",
          sourceLink: "https://www.goa.gov.in/news/goa-launches-motorcycle-taxi-booking-app",
          isEV: false,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        },
        {
          id: "init-preset-13",
          date: "2026-07-07",
          weekday: "Tuesday",
          category: "New Product",
          news: "Komaki launches metal-body electric scooters starting at ₹73,999",
          fullText: "Komaki Electric Division has launched its premium line of metal-body electric scooters in India, with prices starting at Rs 73,999. Engineered for durable performance in rugged urban conditions, the scooters feature high-density thermal management batteries, dual regenerative brakes, and robust steel frames to ensure superior passenger safety.",
          sourceLink: "https://www.komaki.in/news-media/komaki-metal-body-electric-scooters",
          isEV: true,
          side: "l" as const,
          remark: "Manually Shortlisted (Omission Recovery Check)",
          excluded: false
        }
      ];
      localStorage.setItem('autocuration_weekly_news', JSON.stringify(initialPresets));
      return initialPresets;
    } catch {
      return [];
    }
  });

  const [extractingDays, setExtractingDays] = useState<Record<string, boolean>>({});

  const [excludedWeekdays, setExcludedWeekdays] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('autocuration_excluded_weekdays');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveExcludedWeekdays = (days: string[]) => {
    setExcludedWeekdays(days);
    localStorage.setItem('autocuration_excluded_weekdays', JSON.stringify(days));
  };

  const handleToggleDayWordExclusion = (dayName: string) => {
    if (excludedWeekdays.includes(dayName)) {
      saveExcludedWeekdays(excludedWeekdays.filter(d => d !== dayName));
      toast.success(`Included ${dayName} news in the Word file compilation.`);
    } else {
      saveExcludedWeekdays([...excludedWeekdays, dayName]);
      toast.info(`Excluded ${dayName} news from the Word file compilation.`);
    }
  };

  const [dayToClear, setDayToClear] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; headline: string } | null>(null);
  const [weeklyCategoryFilter, setWeeklyCategoryFilter] = useState<string | null>(null);
  const [curationCategoryFilter, setCurationCategoryFilter] = useState<string | null>(null);

  const handleClearDayNews = (dayName: string) => {
    setDayToClear(dayName);
  };

  const executeClearDayNews = () => {
    if (dayToClear) {
      const updated = weeklyNews.filter(item => item.weekday !== dayToClear);
      saveWeeklyNews(updated);
      toast.success(`Cleared all news items for ${dayToClear} from the board.`);
      setDayToClear(null);
    }
  };

  const executeDeleteWeeklyItem = () => {
    if (itemToDelete) {
      saveWeeklyNews(prev => prev.filter(item => item.id !== itemToDelete.id));
      toast.info("Deleted from weekly draft.");
      setItemToDelete(null);
    }
  };

  const [progressNotes, setProgressNotes] = useState<string>(() => {
    return localStorage.getItem('autocuration_weekly_notes') || '';
  });

  const [currentFridayDate, setCurrentFridayDate] = useState<string>(() => {
    const saved = localStorage.getItem('autocuration_current_friday');
    if (saved) return saved;
    // Auto calculate next Friday
    const d = new Date();
    const day = d.getDay();
    const diff = (5 - day + 7) % 7; // days till Friday
    const nextFriday = new Date();
    nextFriday.setDate(d.getDate() + diff);
    return nextFriday.toISOString().split('T')[0];
  });

  const saveWeeklyNews = (updaterOrNewItems: any[] | ((prev: any[]) => any[])) => {
    setWeeklyNews(prev => {
      const next = typeof updaterOrNewItems === 'function' ? updaterOrNewItems(prev) : updaterOrNewItems;
      localStorage.setItem('autocuration_weekly_news', JSON.stringify(next));
      return next;
    });
  };

  const saveProgressNotes = (notes: string) => {
    setProgressNotes(notes);
    localStorage.setItem('autocuration_weekly_notes', notes);
  };

  const saveFridayDate = (dateVal: string) => {
    setCurrentFridayDate(dateVal);
    localStorage.setItem('autocuration_current_friday', dateVal);
  };

  const getLocalDateForWeekday = (weekday: string, fridayDateStr: string): string => {
    try {
      const d = new Date(fridayDateStr);
      if (isNaN(d.getTime())) return fridayDateStr;
      const offsets: Record<string, number> = {
        "Saturday": -6,
        "Monday": -4,
        "Tuesday": -3,
        "Wednesday": -2,
        "Thursday": -1,
        "Friday": 0
      };
      const offset = offsets[weekday] || 0;
      const targetDate = new Date(d);
      targetDate.setDate(d.getDate() + offset);
      return targetDate.toISOString().split('T')[0];
    } catch {
      return fridayDateStr;
    }
  };

  const getWeekdayFromDate = (dateStr: string, fridayDateStr: string): string => {
    if (!dateStr) return "Saturday";
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const matchedDay = days.find(d => d.toLowerCase() === dateStr.trim().toLowerCase());
    if (matchedDay) return matchedDay;
    
    try {
      let parseableStr = dateStr;
      if (/^\d{1,2}-[a-zA-Z]{3}$/.test(dateStr)) {
        const year = fridayDateStr ? new Date(fridayDateStr).getFullYear() : new Date().getFullYear();
        parseableStr = `${dateStr}-${year}`;
      }
      const d = new Date(parseableStr);
      if (!isNaN(d.getTime())) {
        return days[d.getDay()];
      }
    } catch (e) {
      console.error(e);
    }
    return "Saturday";
  };

  // Manual manual addition form states
  const [manualWeekday, setManualWeekday] = useState<string>('Saturday');
  const [manualCategory, setManualCategory] = useState<string>('Corporate');
  const [manualNews, setManualNews] = useState<string>('');
  const [manualFullText, setManualFullText] = useState<string>('');
  const [manualSourceLink, setManualSourceLink] = useState<string>('');
  const [manualIsEV, setManualIsEV] = useState<boolean>(false);
  const [manualSide, setManualSide] = useState<'l' | 'r'>('l');

  // Active curation batch import states
  const [importDate, setImportDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [importWeekday, setImportWeekday] = useState<string>(() => {
    const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return weekdaysList[new Date().getDay()];
  });
  const [showImportDialog, setShowImportDialog] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [showCurationResetConfirm, setShowCurationResetConfirm] = useState<boolean>(false);
  const [showAddStoryModal, setShowAddStoryModal] = useState<boolean>(false);

  const handleClearActiveCuration = () => {
    setResult(null);
    setFile(null);
    setImageInlineData(null);
    setRawUploadedText('');
    setShowCurationResetConfirm(false);
    toast.success("Active curation batch cleared successfully.");
  };

  const handleUpdateImportDate = (newDate: string) => {
    setImportDate(newDate);
    const dObj = new Date(newDate);
    if (!isNaN(dObj.getTime())) {
      const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      setImportWeekday(weekdaysList[dObj.getDay()]);
    }
  };

  // Curation Repair Assistant States
  const [repairDate, setRepairDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [repairWeekday, setRepairWeekday] = useState<string>(() => {
    const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return weekdaysList[new Date().getDay()];
  });
  const [repairHeadlinesText, setRepairHeadlinesText] = useState<string>('');
  const [repairFile, setRepairFile] = useState<File | null>(null);
  const [repairRawText, setRepairRawText] = useState<string>('');
  const [repairParsing, setRepairParsing] = useState<boolean>(false);
  const [repairProcessing, setRepairProcessing] = useState<boolean>(false);
  const [repairProgress, setRepairProgress] = useState<number>(0);
  const [repairOverwrite, setRepairOverwrite] = useState<boolean>(true);

  // Date-wise raw source files states and storage
  const [dailyRawFiles, setDailyRawFiles] = useState<Record<string, { fileName: string; content: string }>>(() => {
    try {
      const saved = localStorage.getItem('autocuration_daily_raw_files');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const saveDailyRawFiles = (
    next: Record<string, { fileName: string; content: string }> | 
    ((prev: Record<string, { fileName: string; content: string }>) => Record<string, { fileName: string; content: string }>)
  ) => {
    setDailyRawFiles(prev => {
      const updated = typeof next === 'function' ? next(prev) : next;
      try {
        localStorage.setItem('autocuration_daily_raw_files', JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save daily raw files to localStorage:", e);
        toast.warning("Local storage limit reached. Raw files will remain in-memory for this session.");
      }
      return updated;
    });
  };

  const [selectedRawFileDate, setSelectedRawFileDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [selectedRawFileWeekday, setSelectedRawFileWeekday] = useState<string>(() => {
    const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return weekdaysList[new Date().getDay()];
  });
  const [uploadingRawFile, setUploadingRawFile] = useState<boolean>(false);
  const [extractingRawFiles, setExtractingRawFiles] = useState<boolean>(false);

  const handleUpdateRawFileDate = (newDate: string) => {
    setSelectedRawFileDate(newDate);
    const dObj = new Date(newDate);
    if (!isNaN(dObj.getTime())) {
      const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      setSelectedRawFileWeekday(weekdaysList[dObj.getDay()]);
    }
  };

  const handleUploadRawFileForDate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileSelected = e.target.files?.[0];
    if (!fileSelected) return;

    setUploadingRawFile(true);
    try {
      toast.info(`Parsing and indexing ${fileSelected.name}...`);
      const text = await parseFile(fileSelected);
      if (!text.trim()) {
        throw new Error("Parsed file contains no text.");
      }

      const dateKey = selectedRawFileDate;
      const weekdayKey = selectedRawFileWeekday;

      saveDailyRawFiles(prev => {
        const next = { ...prev };
        // Store under date key
        next[dateKey] = {
          fileName: fileSelected.name,
          content: text
        };
        // Also store under weekday key as fallback
        next[weekdayKey] = {
          fileName: fileSelected.name,
          content: text
        };
        return next;
      });

      toast.success(`Successfully uploaded raw source file for ${selectedRawFileWeekday}, ${dateKey}!`);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to upload/parse raw file: " + err.message);
    } finally {
      setUploadingRawFile(false);
      // Reset input element value so same file can be uploaded again if needed
      e.target.value = '';
    }
  };

  const handleAutoExtractFromDailyFiles = async () => {
    const activeItems = weeklyNews.filter(item => !item.excluded);
    if (activeItems.length === 0) {
      toast.error("No active news items in the weekly draft board to extract.");
      return;
    }

    const groups: Record<string, { rawText: string; fileName: string; items: typeof weeklyNews }> = {};

    activeItems.forEach(item => {
      let match = null;
      let keyMatched = "";

      if (item.date && dailyRawFiles[item.date]) {
        match = dailyRawFiles[item.date];
        keyMatched = item.date;
      } else if (item.weekday && dailyRawFiles[item.weekday]) {
        match = dailyRawFiles[item.weekday];
        keyMatched = item.weekday;
      }

      if (match && match.content.trim()) {
        if (!groups[keyMatched]) {
          groups[keyMatched] = {
            rawText: match.content,
            fileName: match.fileName,
            items: []
          };
        }
        groups[keyMatched].items.push(item);
      }
    });

    let matchedKeys = Object.keys(groups);
    const fallbackText = rawUploadedText.trim() || repairRawText.trim();

    if (matchedKeys.length === 0 && fallbackText) {
      groups["all_items"] = {
        rawText: fallbackText,
        fileName: file ? file.name : "Uploaded Raw Source File",
        items: activeItems
      };
      matchedKeys = ["all_items"];
    }

    if (matchedKeys.length === 0) {
      toast.error("Please upload raw news source file(s) first (via the right panel or Active Curation tab).");
      return;
    }

    setExtractingRawFiles(true);
    setProcessing(true);
    setProgress(10);

    try {
      toast.info(`Extracting full verbatim text for ${activeItems.length} news items...`);
      
      let updatedWeeklyNews = [...weeklyNews];
      let extractedCount = 0;

      for (let i = 0; i < matchedKeys.length; i++) {
        const key = matchedKeys[i];
        const group = groups[key];
        
        setProgress(Math.round(10 + (i / matchedKeys.length) * 80));
        toast.info(`Extracting detailed narratives from "${group.fileName}" for ${group.items.length} items...`);

        const compiled = await extractDetailedNews(group.items, group.rawText, true);

        updatedWeeklyNews = updatedWeeklyNews.map(originalItem => {
          const extractedItem = compiled.find(c => c.id === originalItem.id);
          if (extractedItem) {
            extractedCount++;
            return {
              ...originalItem,
              fullText: extractedItem.fullText || originalItem.fullText || originalItem.news,
              sourceLink: extractedItem.sourceLink || originalItem.sourceLink || "",
              isEV: extractedItem.isEV ?? originalItem.isEV,
              news: extractedItem.news || originalItem.news
            };
          }
          return originalItem;
        });
      }

      saveWeeklyNews(updatedWeeklyNews);
      setProgress(100);
      toast.success(`Verbatim extraction complete! Extracted full multi-paragraph stories and links for ${extractedCount} news item(s).`);
    } catch (err: any) {
      console.error(err);
      toast.error("Verbatim extraction failed: " + err.message);
    } finally {
      setExtractingRawFiles(false);
      setProcessing(false);
      setProgress(0);
    }
  };

  const handleUpdateRepairDate = (newDate: string) => {
    setRepairDate(newDate);
    const dObj = new Date(newDate);
    if (!isNaN(dObj.getTime())) {
      const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      setRepairWeekday(weekdaysList[dObj.getDay()]);
    }
  };

  const handleLoadRepairHeadlines = () => {
    const dayNews = weeklyNews.filter(item => item.weekday === repairWeekday && !item.excluded);
    if (dayNews.length === 0) {
      toast.info(`No active headlines found on the Board for ${repairWeekday}.`);
      setRepairHeadlinesText('');
      return;
    }
    const headlines = dayNews.map(item => item.news).join('\n');
    setRepairHeadlinesText(headlines);
    toast.success(`Loaded ${dayNews.length} active headline(s) from the Board for ${repairWeekday}!`);
  };

  const handleRepairDayCuration = async () => {
    if (!repairFile) {
      toast.error("Please select or upload the raw source file for this day first.");
      return;
    }
    const lines = repairHeadlinesText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    if (lines.length === 0) {
      toast.error("Please provide at least one news headline to extract.");
      return;
    }

    setRepairProcessing(true);
    setRepairProgress(10);

    try {
      let sourceText = repairRawText || "";
      if (!sourceText.trim()) {
        setRepairProgress(30);
        toast.info(`Extracting contents from ${repairFile.name}...`);
        sourceText = await parseFile(repairFile);
        setRepairRawText(sourceText);
      }

      setRepairProgress(50);
      toast.info(`Running smart verbatim extractor for ${lines.length} headline(s)...`);

      const queryItems = lines.map((headline, idx) => ({
        id: `repair_${idx}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        news: headline,
        category: 'Corporate',
        weekday: repairWeekday,
        date: repairDate,
      }));

      setRepairProgress(70);
      const compiledItems = await extractDetailedNews(queryItems, sourceText);
      setRepairProgress(90);

      const formattedItems = compiledItems.map(item => {
        return {
          id: item.id || Math.random().toString(36).substring(2, 9),
          date: repairDate,
          weekday: repairWeekday,
          category: item.category || 'Corporate',
          news: applyStrictSOPCleaning(item.news),
          fullText: applyStrictSOPCleaning(item.fullText || item.news),
          sourceLink: item.sourceLink || '',
          isEV: item.isEV || item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification",
          side: item.side || 'l',
          remark: applyStrictSOPCleaning('Extracted via Day Curation Repair Assistant')
        };
      });

      saveWeeklyNews(prev => {
        let base = [...prev];
        if (repairOverwrite) {
          base = base.filter(item => item.weekday !== repairWeekday);
        }
        
        let addedCount = 0;
        let dupCount = 0;
        
        formattedItems.forEach(newItem => {
          const exists = base.some(existing => existing.news.trim().toLowerCase() === newItem.news.trim().toLowerCase());
          if (!exists) {
            base.push(newItem);
            addedCount++;
          } else {
            dupCount++;
          }
        });
        
        toast.success(`Successfully repaired ${repairWeekday}! Added ${addedCount} verified, un-truncated stories (${dupCount} duplicate(s) ignored).`);
        return base;
      });

    } catch (err: any) {
      console.error(err);
      toast.error("Curation repair failed: " + err.message);
    } finally {
      setRepairProcessing(false);
      setRepairProgress(0);
    }
  };

  const [modalWeekday, setModalWeekday] = useState<string>('Saturday');
  const [modalCategory, setModalCategory] = useState<string>('Indian Passenger Car Market');
  const [modalHeadline, setModalHeadline] = useState<string>('');
  const [modalFullText, setModalFullText] = useState<string>('');
  const [modalSourceLink, setModalSourceLink] = useState<string>('');
  const [modalIsEV, setModalIsEV] = useState<boolean>(false);
  const [modalLayoutSide, setModalLayoutSide] = useState<'l' | 'r'>('l');

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  const handleAddCustomStoryFromModal = () => {
    if (!modalHeadline.trim()) {
      toast.error("Headline/Title is required.");
      return;
    }
    const newItem = {
      id: "manual-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      date: currentFridayDate,
      weekday: modalWeekday,
      category: modalCategory,
      news: applyStrictSOPCleaning(modalHeadline),
      fullText: applyStrictSOPCleaning(modalFullText || modalHeadline),
      sourceLink: modalSourceLink,
      isEV: modalIsEV || modalCategory === "Electrification",
      side: modalLayoutSide,
      remark: "",
      excluded: false
    };

    saveWeeklyNews(prev => [...prev, newItem]);
    toast.success("Successfully added custom story!");
    
    // reset fields
    setModalHeadline('');
    setModalFullText('');
    setModalSourceLink('');
    setModalIsEV(false);
    setShowAddStoryModal(false);
  };

  const handleOpenImportDialog = () => {
    if (result && result.items.length > 0) {
      const batchDate = result.items[0].date || new Date().toISOString().split('T')[0];
      setImportDate(batchDate);
      const dObj = new Date(batchDate);
      if (!isNaN(dObj.getTime())) {
        const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        setImportWeekday(weekdaysList[dObj.getDay()]);
      } else {
        setImportWeekday('Saturday');
      }
    }
    setShowImportDialog(true);
  };

  const getWeekRangeString = (fridayDateStr: string) => {
    const friday = new Date(fridayDateStr);
    if (isNaN(friday.getTime())) return "Current Week";
    const saturday = new Date(friday);
    saturday.setDate(friday.getDate() - 6);
    
    const formatDate = (d: Date) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${d.getDate()}-${months[d.getMonth()]}`;
    };
    
    return `${formatDate(saturday)} to ${formatDate(friday)}`;
  };

  const handleAddToWeeklyCollation = async (selectedDate?: string, selectedWeekday?: string) => {
    if (!result || result.items.length === 0) {
      toast.error("No curation batch results to send.");
      return;
    }
    
    setProcessing(true);
    setProgress(20);
    try {
      toast.info("Extracting detailed headlines, narrative, and source URLs...");
      let sourceText = rawUploadedText;
      if (!sourceText && file) {
        try {
          sourceText = await parseFile(file);
          setRawUploadedText(sourceText);
        } catch (fErr) {
          console.error(fErr);
          throw new Error("The file stream has expired in the browser. Please re-upload or select original file again.");
        }
      }
      
      setProgress(50);
      const compiledItems = await extractDetailedNews(result.items, sourceText);
      
      setProgress(80);
      const weekdaysList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      const itemsWithWeekdays = compiledItems.map(item => {
        const original = result.items?.find((o: any) => o.id === item.id);
        const dateVal = selectedDate || original?.date || new Date().toISOString().split('T')[0];
        
        let weekday = selectedWeekday || 'Saturday';
        if (!selectedWeekday) {
          const dObj = new Date(dateVal);
          if (!isNaN(dObj.getTime())) {
            weekday = weekdaysList[dObj.getDay()];
          }
        }
        
        return {
          id: item.id || Math.random().toString(36).substring(2, 9),
          date: dateVal,
          weekday,
          category: item.category,
          news: applyStrictSOPCleaning(item.news),
          fullText: applyStrictSOPCleaning(item.fullText || item.news),
          sourceLink: item.sourceLink || original?.sourceLink || '',
          isEV: item.isEV || item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification",
          side: item.side || original?.side || 'l',
          remark: applyStrictSOPCleaning(original?.remark || '')
        };
      });
      
      // Merge
      saveWeeklyNews(prev => {
        const merged = [...prev];
        let addedCount = 0;
        let dupCount = 0;
        
        itemsWithWeekdays.forEach(newItem => {
          const exists = merged.some(existing => existing.news.trim().toLowerCase() === newItem.news.trim().toLowerCase());
          if (!exists) {
            merged.push(newItem);
            addedCount++;
          } else {
            dupCount++;
          }
        });
        
        toast.success(
          dupCount > 0 
            ? `Merged: Added ${addedCount} new headlines to Weekly Tracker (${dupCount} duplicate(s) ignored).`
            : `Successfully added all ${addedCount} items to your Weekly Draft Tracker!`
        );
        return merged;
      });
      
      setActiveView('weekly'); // Switch tab to review our live word document board!
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to add to Weekly Tracker: " + err.message);
    } finally {
      setProcessing(false);
      setProgress(0);
      setShowImportDialog(false);
    }
  };

  const handleAddManualItem = () => {
    if (!manualNews.trim()) {
      toast.error("Headline is required.");
      return;
    }
    
    const newItem = {
      id: Math.random().toString(36).substring(2, 9),
      date: new Date().toISOString().split('T')[0],
      weekday: manualWeekday,
      category: manualCategory,
      news: applyStrictSOPCleaning(manualNews),
      fullText: applyStrictSOPCleaning(manualFullText || manualNews),
      sourceLink: manualSourceLink,
      isEV: manualIsEV || manualNews.toLowerCase().includes("electric") || manualNews.toLowerCase().includes("ev ") || manualCategory === "Electrification",
      side: manualSide,
      remark: ""
    };
    
    saveWeeklyNews(prev => [...prev, newItem]);
    toast.success("Manual headline added to weekly draft!");
    
    // reset manual fields
    setManualNews('');
    setManualFullText('');
    setManualSourceLink('');
    setManualIsEV(false);
  };

  const handleUpdateWeeklyItem = (id: string, fieldsToUpdate: Partial<any>) => {
    saveWeeklyNews(prev => {
      return prev.map(item => {
        if (item.id === id) {
          const cleanedFields = { ...fieldsToUpdate };
          if (cleanedFields.news !== undefined) cleanedFields.news = applyStrictSOPCleaning(cleanedFields.news);
          if (cleanedFields.fullText !== undefined) cleanedFields.fullText = applyStrictSOPCleaning(cleanedFields.fullText);
          
          const updated = { ...item, ...cleanedFields };
          if (fieldsToUpdate.category === "Electrification") {
            updated.isEV = true;
          }
          return updated;
        }
        return item;
      });
    });
  };

  const handleDeleteWeeklyItem = (id: string) => {
    saveWeeklyNews(prev => prev.filter(item => item.id !== id));
    toast.info("Deleted from weekly draft.");
  };

  const handleClearWeeklyCollation = () => {
    setShowResetConfirm(true);
  };

  const executeClearWeeklyCollation = () => {
    saveWeeklyNews([]);
    saveProgressNotes('');
    saveExcludedWeekdays([]);
    
    const d = new Date();
    const day = d.getDay();
    const diff = (5 - day + 7) % 7;
    const nextFriday = new Date();
    nextFriday.setDate(d.getDate() + diff);
    const nextFridayStr = nextFriday.toISOString().split('T')[0];
    setCurrentFridayDate(nextFridayStr);
    localStorage.setItem('autocuration_current_friday', nextFridayStr);
    
    toast.success("Weekly draft, progress notes, and compilation date reset successfully.");
    setShowResetConfirm(false);
  };

  const handleToggleWeeklyItemExcluded = (id: string) => {
    saveWeeklyNews(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, excluded: !item.excluded };
      }
      return item;
    }));
  };

  const handleDownloadWeeklyWord = async () => {
    if (weeklyNews.length === 0) {
      toast.error("No items in weekly draft. Add some first!");
      return;
    }
    
    const activeItems = weeklyNews.filter(item => !item.excluded && !excludedWeekdays.includes(item.weekday || 'Saturday'));
    if (activeItems.length === 0) {
      toast.error("All curated headlines (or their weekdays) are currently excluded. Toggle them or include their days in the Friday tracker before compiling!");
      return;
    }

    setProcessing(true);
    try {
      const groupsToExtract: Record<string, { rawText: string; items: typeof weeklyNews }> = {};

      activeItems.forEach(item => {
        const needsExtraction = !item.fullText || item.fullText.trim() === "" || item.fullText === item.news || item.fullText === "Content not available";
        if (needsExtraction) {
          let match = null;
          let keyMatched = "";

          if (item.date && dailyRawFiles[item.date]) {
            match = dailyRawFiles[item.date];
            keyMatched = item.date;
          } else if (item.weekday && dailyRawFiles[item.weekday]) {
            match = dailyRawFiles[item.weekday];
            keyMatched = item.weekday;
          } else if (item.weekday && dailyRawFiles[item.weekday.toLowerCase()]) {
            match = dailyRawFiles[item.weekday.toLowerCase()];
            keyMatched = item.weekday;
          }

          if (match && match.content.trim()) {
            if (!groupsToExtract[keyMatched]) {
              groupsToExtract[keyMatched] = {
                rawText: match.content,
                items: []
              };
            }
            groupsToExtract[keyMatched].items.push(item);
          } else {
            // Fallback to rawUploadedText or repairRawText if available
            const fallbackText = rawUploadedText.trim() || repairRawText.trim();
            if (fallbackText) {
              const fallbackKey = "global_raw_fallback";
              if (!groupsToExtract[fallbackKey]) {
                groupsToExtract[fallbackKey] = {
                  rawText: fallbackText,
                  items: []
                };
              }
              groupsToExtract[fallbackKey].items.push(item);
            }
          }
        }
      });

      const matchedKeys = Object.keys(groupsToExtract);
      let enrichedItems = [...activeItems];

      if (matchedKeys.length > 0) {
        toast.info(`Extracting verbatim multi-paragraph content for items using raw news files...`);
        
        for (const key of matchedKeys) {
          const group = groupsToExtract[key];
          const compiled = await extractDetailedNews(group.items, group.rawText, true);
          
          enrichedItems = enrichedItems.map(originalItem => {
            const extractedItem = compiled.find(c => c.id === originalItem.id);
            if (extractedItem) {
              return {
                ...originalItem,
                fullText: extractedItem.fullText || "Content not available",
                sourceLink: extractedItem.sourceLink || originalItem.sourceLink || "",
                isEV: extractedItem.isEV ?? originalItem.isEV,
                news: extractedItem.news || originalItem.news
              };
            }
            return originalItem;
          });

          saveWeeklyNews(prev => prev.map(originalItem => {
            const extractedItem = compiled.find(c => c.id === originalItem.id);
            if (extractedItem) {
              return {
                ...originalItem,
                fullText: extractedItem.fullText || "Content not available",
                sourceLink: extractedItem.sourceLink || originalItem.sourceLink || "",
                isEV: extractedItem.isEV ?? originalItem.isEV,
                news: extractedItem.news || originalItem.news
              };
            }
            return originalItem;
          }));
        }
        toast.success("Successfully extracted verbatim narratives from raw files!");
      }

      const rangeStr = getWeekRangeString(currentFridayDate);
      const compiled = enrichedItems.map(item => ({
        id: item.id,
        news: item.news,
        category: item.category,
        side: item.side,
        fullText: (item.fullText && item.fullText.trim() !== "" && item.fullText.trim() !== item.news.trim()) ? item.fullText : "Content not available",
        sourceLink: item.sourceLink || "",
        isEV: item.isEV,
        weekday: item.weekday || 'Saturday',
        date: item.date || currentFridayDate
      }));
      
      generateAndDownloadWordDoc(compiled, rangeStr);
      toast.success(`Downloaded Word document for Friday, ${currentFridayDate}!`);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to compile Word doc: " + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const formatToDMMM = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d.getDate()} ${monthsShort[d.getMonth()]}`;
  };

  const handleDraftDayWord = async (dayName: string) => {
    const dayItems = weeklyNews.filter(item => item.weekday === dayName && !item.excluded);
    if (dayItems.length === 0) {
      toast.error(`No active news items found for ${dayName} in the draft board.`);
      return;
    }
    
    setProcessing(true);
    try {
      let rawContent = "";
      const firstItem = dayItems[0];
      
      if (firstItem.date && dailyRawFiles[firstItem.date]) {
        rawContent = dailyRawFiles[firstItem.date].content;
      } else if (dailyRawFiles[dayName]) {
        rawContent = dailyRawFiles[dayName].content;
      } else if (dailyRawFiles[dayName.toLowerCase()]) {
        rawContent = dailyRawFiles[dayName.toLowerCase()].content;
      } else if (rawUploadedText.trim()) {
        rawContent = rawUploadedText;
      } else if (repairRawText.trim()) {
        rawContent = repairRawText;
      }

      let compiledItemsList = dayItems;
      if (rawContent.trim()) {
        toast.info(`Extracting verbatim story details for ${dayName}...`);
        const extracted = await extractDetailedNews(dayItems, rawContent, true);
        compiledItemsList = dayItems.map(item => {
          const matched = extracted.find(e => e.id === item.id);
          if (matched) {
            return {
              ...item,
              fullText: matched.fullText || "Content not available",
              sourceLink: matched.sourceLink || item.sourceLink || "",
              isEV: matched.isEV ?? item.isEV
            };
          }
          return item;
        });

        // Save back to weekly news state
        saveWeeklyNews(prev => prev.map(item => {
          const matched = extracted.find(e => e.id === item.id);
          if (matched) {
            return {
              ...item,
              fullText: matched.fullText || "Content not available",
              sourceLink: matched.sourceLink || item.sourceLink || "",
              isEV: matched.isEV ?? item.isEV
            };
          }
          return item;
        }));
      }

      const dateStr = firstItem.date ? formatToDMMM(firstItem.date) : dayName;
      const titleStr = `${dayName} Daily Draft (${dateStr})`;
      
      const compiled = compiledItemsList.map(item => ({
        id: item.id,
        news: item.news,
        category: item.category,
        side: item.side,
        fullText: (item.fullText && item.fullText.trim() !== "" && item.fullText.trim() !== item.news.trim()) ? item.fullText : "Content not available",
        sourceLink: item.sourceLink || "",
        isEV: item.isEV,
        weekday: item.weekday || dayName,
        date: item.date || currentFridayDate
      }));
      
      generateAndDownloadWordDoc(compiled, titleStr);
      toast.success(`Successfully compiled and downloaded Word document for ${dayName}!`);
    } catch (err: any) {
      console.error(err);
      toast.error(`Failed to draft Word file for ${dayName}: ` + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadDayExcel = (dayName: string) => {
    const dayItems = weeklyNews.filter(item => item.weekday === dayName && !item.excluded);
    if (dayItems.length === 0) {
      toast.error(`No active news items found for ${dayName} to export.`);
      return;
    }
    
    const preparedItems = dayItems.map(item => ({
      id: item.id,
      date: item.date || currentFridayDate,
      category: item.category,
      news: item.news,
      side: item.side || 'l',
      remark: item.remark || '',
      sourceLink: item.sourceLink || ''
    }));

    exportToExcel(preparedItems, `${dayName}_Shortlist_${formatToDMMM(preparedItems[0].date)}`);
    toast.success(`Downloaded Excel spreadsheet for ${dayName}!`);
  };

  const handleDownloadDayJSON = (dayName: string) => {
    const dayItems = weeklyNews.filter(item => item.weekday === dayName);
    if (dayItems.length === 0) {
      toast.error(`No news items found for ${dayName} to export.`);
      return;
    }
    
    const fileData = {
      weekday: dayName,
      downloadedAt: new Date().toISOString(),
      shortlist: dayItems
    };

    const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const firstItem = dayItems[0];
    const dateStr = firstItem.date || currentFridayDate;
    a.href = url;
    a.download = `Shortlist_Database_${dayName}_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded shortlisted database for ${dayName} (.json)`);
  };

  const handleExtractDayDetails = async (dayName: string) => {
    const dayItems = weeklyNews.filter(item => item.weekday === dayName);
    if (dayItems.length === 0) {
      toast.error(`No news items found for ${dayName} in the draft board.`);
      return;
    }
    
    let combinedText = "";
    if (repairRawText.trim() && repairWeekday === dayName) {
      combinedText = repairRawText;
      toast.info(`Using uploaded repair file text for ${dayName} details...`);
    } else if (rawUploadedText.trim() && importWeekday === dayName) {
      combinedText = rawUploadedText;
      toast.info(`Using active curation uploaded text for ${dayName} details...`);
    } else if (rawUploadedText.trim()) {
      combinedText = rawUploadedText;
      toast.info(`Using recently uploaded file text for ${dayName} details...`);
    } else if (repairRawText.trim()) {
      combinedText = repairRawText;
      toast.info(`Using recently uploaded repair file text for ${dayName} details...`);
    } else {
      toast.error(`Please upload the raw news source file first (either in the Active Curation tab or via the Day Repair panel on the Weekly Draft Board).`);
      return;
    }
    
    setExtractingDays(prev => ({ ...prev, [dayName]: true }));
    setProgress(20);
    
    try {
      toast.info(`Extracting full text and links for ${dayItems.length} items on ${dayName}...`);
      setProgress(50);
      const compiled = await extractDetailedNews(dayItems, combinedText);
      setProgress(80);
      
      saveWeeklyNews(prev => {
        return prev.map(item => {
          if (item.weekday === dayName) {
            const matched = compiled.find(c => c.id === item.id);
            if (matched) {
              return {
                ...item,
                fullText: matched.fullText || item.fullText || item.news,
                sourceLink: matched.sourceLink || item.sourceLink || "",
                isEV: matched.isEV ?? item.isEV ?? (item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification")
              };
            }
          }
          return item;
        });
      });
      
      setProgress(100);
      toast.success(`Successfully extracted full narratives and links for ${dayName}! Check the preview below.`);
    } catch (err: any) {
      console.error(err);
      toast.error(`Extraction failed: ` + err.message);
    } finally {
      setExtractingDays(prev => ({ ...prev, [dayName]: false }));
      setProgress(0);
    }
  };

  const handleDownloadWeeklyExcel = () => {
    if (weeklyNews.length === 0) {
      toast.error("No items in weekly draft. Add some first!");
      return;
    }
    
    const activeItems = weeklyNews.filter(item => !item.excluded && !excludedWeekdays.includes(item.weekday || 'Saturday'));
    if (activeItems.length === 0) {
      toast.error("All curated headlines (or their weekdays) are currently excluded. Toggle them or include their days in the Friday tracker!");
      return;
    }
    
    const rangeStr = getWeekRangeString(currentFridayDate);
    const preparedItems = activeItems.map(item => ({
      id: item.id,
      date: item.date || currentFridayDate,
      category: item.category,
      news: item.news,
      side: item.side || 'l',
      remark: item.remark || '',
      sourceLink: item.sourceLink || ''
    }));

    exportToExcel(preparedItems, rangeStr);
    toast.success(`Downloaded Excel spreadsheet for Friday, ${currentFridayDate}!`);
  };

  const handleDownloadWeeklyJSON = () => {
    if (weeklyNews.length === 0) {
      toast.error("No items in weekly draft. Add some first!");
      return;
    }
    const activeItems = weeklyNews.filter(item => !item.excluded && !excludedWeekdays.includes(item.weekday || 'Saturday'));
    const rangeStr = getWeekRangeString(currentFridayDate);
    const fileData = {
      cycleRange: rangeStr,
      compiledFridayDate: currentFridayDate,
      totalShortlistedCount: weeklyNews.length,
      includedCount: activeItems.length,
      excludedCount: weeklyNews.length - activeItems.length,
      excludedWeekdaysList: excludedWeekdays,
      downloadedAt: new Date().toISOString(),
      shortlist: weeklyNews
    };

    const blob = new Blob([JSON.stringify(fileData, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Weekly_Shortlist_Database_${currentFridayDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded complete shortlists database (.json)");
  };

  const handleDownloadWeeklyTXT = () => {
    if (weeklyNews.length === 0) {
      toast.error("No items in weekly draft. Add some first!");
      return;
    }
    const rangeStr = getWeekRangeString(currentFridayDate);
    const activeItems = weeklyNews.filter(item => !item.excluded && !excludedWeekdays.includes(item.weekday || 'Saturday'));

    let txt = `========================================================================\n`;
    txt += `         WEEKLY SHORTLISTED AUTO NEWS COMPILATION (PORTABLE RAW TXT)\n`;
    txt += `========================================================================\n`;
    txt += `Cycle Range: ${rangeStr}\n`;
    txt += `Friday Date: ${currentFridayDate}\n`;
    txt += `Total Items Curated: ${weeklyNews.length} (${activeItems.length} included, ${weeklyNews.length - activeItems.length} excluded)\n`;
    if (excludedWeekdays.length > 0) {
      txt += `Excluded Days of the Week: ${excludedWeekdays.join(", ")}\n`;
    }
    txt += `========================================================================\n\n`;

    const weekdaysOrder = ["Saturday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    weekdaysOrder.forEach((day) => {
      if (excludedWeekdays.includes(day)) return;
      const itemsInDay = weeklyNews.filter(item => item.weekday === day);
      if (itemsInDay.length === 0) return;

      txt += `########################################################################\n`;
      txt += `📅 WEEKDAY: ${day.toUpperCase()} Tracker\n`;
      txt += `########################################################################\n\n`;

      itemsInDay.forEach((item, idx) => {
        txt += `[Story #${idx + 1}] [${item.category}] [Side: ${String(item.side).toUpperCase()}]${item.isEV ? ' [⚡ EV]' : ''}${item.excluded ? ' -- EXCLUDED FROM ACTIVE WORD --' : ''}\n`;
        txt += `Title/Headline: ${item.news}\n`;
        if (item.sourceLink) {
          txt += `Source: ${item.sourceLink}\n`;
        }
        txt += `------------------------------------------------------------------------\n`;
        txt += `Narrative:\n${item.fullText || item.news}\n`;
        txt += `========================================================================\n\n`;
      });
    });

    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Newsletter_TXT_Draft_${currentFridayDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded raw daily-shortlisted portable text draft!");
  };

  const [summaryTextInput, setSummaryTextInput] = useState('');
  const [summaryFileName, setSummaryFileName] = useState('');
  const [summaryTextOutput, setSummaryTextOutput] = useState('');
  const [summaryArticles, setSummaryArticles] = useState<Array<{ 
    headline: string; 
    sourceLink: string; 
    summary: string;
    category?: string;
    publishDate?: string;
    sourceName?: string;
  }>>([]);

  const groupedSummaryArticles = React.useMemo(() => {
    const categoryOrder: string[] = [];
    const groups: Record<string, typeof summaryArticles> = {};
    summaryArticles.forEach((art) => {
      const cat = art.category?.trim() || "General News";
      if (!groups[cat]) {
        groups[cat] = [];
        categoryOrder.push(cat);
      }
      groups[cat].push(art);
    });
    return categoryOrder.map((cat) => ({
      categoryName: cat,
      articles: groups[cat],
    }));
  }, [summaryArticles]);

  const [summarizing, setSummarizing] = useState(false);
  const [summarizingFile, setSummarizingFile] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Queue Slider & View Configuration
  const [queueViewMode, setQueueViewMode] = useState<'table' | 'slider'>('table');
  const [activeSliderIndex, setActiveSliderIndex] = useState(0);

  const convertImageToBase64 = (fileObj: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const res = e.target?.result as string;
        if (res) {
          resolve(res.split(',')[1]);
        } else {
          reject(new Error("Failed to read image as base64 string"));
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Error reading file"));
      reader.readAsDataURL(fileObj);
    });
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      setParsingFile(true);
      setResult(null);
      setProgress(0);
      try {
        const isImage = selectedFile.type.startsWith('image/');
        const isZip = selectedFile.name.toLowerCase().endsWith('.zip');
        
        if (isZip) {
          setImageInlineData(null);
          toast.info(`Extracting ZIP folder: ${selectedFile.name}...`);
          const zip = await JSZip.loadAsync(selectedFile as any);
          let combinedText = '';
          const zipPromises: Promise<void>[] = [];
          
          zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir || relativePath.startsWith('__MACOSX') || relativePath.split('/').pop()?.startsWith('.')) {
              return;
            }
            const promise = zipEntry.async('uint8array').then(async (content) => {
              const extractedFile = new File([content], zipEntry.name);
              try {
                const text = await parseFile(extractedFile);
                combinedText += `=== EXTRACTED FILE: ${zipEntry.name} ===\n\n${text}\n\n`;
              } catch (err: any) {
                console.error(`Error parsing extracted file ${zipEntry.name}:`, err);
              }
            });
            zipPromises.push(promise);
          });
          
          await Promise.all(zipPromises);
          setRawUploadedText(combinedText);
          toast.success(`Loaded and unpacked ZIP: extracted ${zipPromises.length} files!`);
        } else if (!isImage) {
          setImageInlineData(null);
          const rawText = await parseFile(selectedFile);
          setRawUploadedText(rawText);
          toast.success(`Loaded and parsed: ${selectedFile.name}`);
        } else {
          const base64 = await convertImageToBase64(selectedFile);
          setImageInlineData({
            data: base64,
            mimeType: selectedFile.type
          });
          setRawUploadedText('Image loaded for curation scan.');
          toast.success(`Loaded image: ${selectedFile.name}`);
        }
      } catch (err: any) {
        console.error(err);
        toast.error("Failed to parse file: " + err.message);
      } finally {
        setParsingFile(false);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.txt'],
      'text/html': ['.html'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'application/zip': ['.zip']
    }
  } as any);

  const { 
    getRootProps: getSummaryRootProps, 
    getInputProps: getSummaryInputProps, 
    isDragActive: isSummaryDragActive 
  } = useDropzone({
    onDrop: async (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        const selectedFile = acceptedFiles[0];
        setSummarizingFile(true);
        try {
          const text = await parseFile(selectedFile);
          setSummaryTextInput(text);
          setSummaryFileName(selectedFile.name);
          toast.success(`Loaded and parsed: ${selectedFile.name}`);
        } catch (err: any) {
          console.error("Error parsing file in summary view:", err);
          toast.error("Failed to parse file: " + err.message);
        } finally {
          setSummarizingFile(false);
        }
      }
    },
    multiple: false
  } as any);

  const handleProcess = async () => {
    if (!file) {
      toast.error("Please upload or enter file contents first.");
      return;
    }

    setProcessing(true);
    setProgress(10);
    setResult(null);

    try {
      setProgress(20);
      const isImage = file.type.startsWith('image/');
      let rawText = rawUploadedText || "";
      let inlineData;

      if (isImage) {
        setProgress(30);
        if (imageInlineData) {
          inlineData = imageInlineData;
        } else {
          const base64 = await convertImageToBase64(file);
          inlineData = {
            data: base64,
            mimeType: file.type
          };
          setImageInlineData(inlineData);
        }
      } else {
        setProgress(30);
        if (!rawText.trim()) {
          rawText = await parseFile(file);
          setRawUploadedText(rawText);
        }
      }
      
      setProgress(50);
      const existingTitles = weeklyNews.map(item => item.news || item.headline || "");
      const curateResult = await curateNews(rawText, file.name, inlineData, existingTitles);

      // Extract the correct date and apply it uniformly to all headlines
      const fileDate = detectFileDate(file.name, rawText);
      console.log(`[Curation] Uniformly applying date: ${fileDate}`);
      
      if (curateResult && curateResult.items) {
        curateResult.items = curateResult.items.map((item, idx) => ({
          ...item,
          id: item.id || `curated_${idx}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          date: fileDate
        }));

        setProgress(70);
        toast.info("Extracting detailed narratives and links...");
        try {
          const compiled = await extractDetailedNews(curateResult.items, rawText);
          curateResult.items = curateResult.items.map(item => {
            const compiledItem = compiled.find(c => c.id === item.id);
            return {
              ...item,
              fullText: compiledItem?.fullText || item.news,
              sourceLink: compiledItem?.sourceLink || "",
              isEV: compiledItem?.isEV || item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification"
            };
          });
        } catch (detailErr) {
          console.error("Failed to extract details on curation:", detailErr);
        }
      }
      
      setProgress(90);
      setResult(curateResult);
      toast.success('Curation complete!');
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || 'Processing failed');
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  const handleExport = () => {
    if (!result || result.items.length === 0) return;
    
    // Derive date from first item in a robust manner
    const firstDate = result.items[0].date;
    const computedRange = formatToDMMM(firstDate) || "Newsletter";

    try {
      exportToExcel(result.items, computedRange);
      toast.success('Excel file generated!');
    } catch (error) {
      toast.error('Failed to export. Please try again.');
    }
  };

  const handleCompileWord = async () => {
    if (!result || result.items.length === 0) return;
    const firstDate = result.items[0].date;
    const computedRange = formatToDMMM(firstDate) || "Newsletter";

    setCompilingWord(true);
    try {
      toast.info("Extracting detailed articles till their source links...");
      
      let sourceText = rawUploadedText;
      if (!sourceText && file) {
        try {
          sourceText = await parseFile(file);
          setRawUploadedText(sourceText);
        } catch (fErr) {
          console.error(fErr);
          throw new Error("The file stream has expired in the browser. Please re-upload or select original file again.");
        }
      }
      
      const compiledItems = await extractDetailedNews(result.items, sourceText);
      generateAndDownloadWordDoc(compiledItems, computedRange);
      toast.success("Word Document compiled successfully!");
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to compile Word file.");
    } finally {
      setCompilingWord(false);
    }
  };

  const handleUpdateItemNews = (idx: number, newNews: string) => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], news: newNews };
    setResult({ ...result, items: updatedItems });
  };

  const handleUpdateItemCategory = (idx: number, newCategory: any) => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], category: newCategory };
    setResult({ ...result, items: updatedItems });
  };

  const handleUpdateItemSide = (idx: number, newSide: "l" | "r") => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], side: newSide };
    setResult({ ...result, items: updatedItems });
  };

  const handleUpdateItemRemark = (idx: number, newRemark: string) => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], remark: newRemark };
    setResult({ ...result, items: updatedItems });
  };

  const handleUpdateItemFullText = (idx: number, newFullText: string) => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], fullText: newFullText };
    setResult({ ...result, items: updatedItems });
  };

  const handleUpdateItemSourceLink = (idx: number, newSourceLink: string) => {
    if (!result) return;
    const updatedItems = [...result.items];
    updatedItems[idx] = { ...updatedItems[idx], sourceLink: newSourceLink };
    setResult({ ...result, items: updatedItems });
  };

  const handleDeleteItem = (idx: number) => {
    if (!result) return;
    const updatedItems = result.items.filter((_, i) => i !== idx);
    setResult({ ...result, items: updatedItems });
    toast.info("Item removed from batch");
    
    // Adjust active slider index safely
    if (activeSliderIndex >= updatedItems.length) {
      setActiveSliderIndex(Math.max(0, updatedItems.length - 1));
    }
  };

  const handleAddItem = () => {
    if (!result) return;
    const baseDate = result.items[0]?.date || new Date().toISOString().split('T')[0];
    const newItem: NewsItem = {
      id: Math.random().toString(36).substring(2, 9),
      date: baseDate,
      category: "Corporate",
      news: "New custom news headline",
      side: "l",
      remark: "",
      fullText: "",
      sourceLink: ""
    };
    const newItems = [...result.items, newItem];
    setResult({ ...result, items: newItems });
    setActiveSliderIndex(newItems.length - 1); // Set focus to the new item
    toast.success("New news slot added!");
  };

  const handleUpdateBatchDate = (newDate: string) => {
    if (!result || !newDate) return;
    const updatedItems = result.items.map(item => ({
      ...item,
      date: newDate
    }));
    setResult({ ...result, items: updatedItems });
    toast.success(`Batch date updated to ${formatToDMMM(newDate)}`);
  };

  const handleSummarize = async () => {
    if (!summaryTextInput.trim()) {
      toast.error("Please enter or paste some text to summarize.");
      return;
    }
    setSummarizing(true);
    setSummaryTextOutput('');
    setSummaryArticles([]);
    try {
      const response = await robustFetch("/api/summarize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawText: summaryTextInput,
        }),
      });

      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        let errMsg = `Server summarization failed with status ${response.status}`;
        if (contentType && contentType.includes("application/json")) {
          const errData = await response.json().catch(() => ({}));
          errMsg = errData.error || errMsg;
        } else {
          const text = await response.text().catch(() => "");
          if (text.includes("<!DOCTYPE") || text.includes("<html")) {
            errMsg = `Server returned HTML page (Status ${response.status}). The API server or proxy might be down or restarting.`;
          } else {
            errMsg = text.slice(0, 150) || errMsg;
          }
        }
        throw new Error(errMsg);
      }

      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text().catch(() => "");
        console.error("Non-JSON summarization response:", text);
        throw new Error(`Expected JSON summarization response but received ${contentType || "unknown content"}. Please try again.`);
      }

      const data = await response.json();
      if (data.articles && Array.isArray(data.articles)) {
        setSummaryArticles(data.articles);
        
        // Form a nice plain text output representation for simple copy/paste and fallback
        const textRep = data.articles.map((art: any) => {
          const headlineStr = art.headline || "News Article";
          const catStr = art.category ? ` [${art.category}]` : '';
          const metaStr = (art.publishDate || art.sourceName) 
            ? `\n(${art.publishDate || 'Date'}${art.sourceName ? `, Source: ${art.sourceName}` : ''})` 
            : '';
          const linkStr = art.sourceLink ? `\nLink: ${art.sourceLink}` : '';
          return `${headlineStr}${catStr}\n${art.summary}${metaStr}${linkStr}`;
        }).join('\n\n');
        
        setSummaryTextOutput(textRep || "No content generated.");
        toast.success(`Successfully summarized ${data.articles.length} news items!`);
      } else if (data.summary) {
        setSummaryTextOutput(data.summary);
        setSummaryArticles([{
          headline: "Factual Summary",
          sourceLink: "",
          summary: data.summary
        }]);
        toast.success("Summary generated!");
      } else {
        throw new Error("Invalid response format received from the server.");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to generate summary");
    } finally {
      setSummarizing(false);
    }
  };

  const handleCopySummary = () => {
    if (!summaryTextOutput) return;
    navigator.clipboard.writeText(summaryTextOutput);
    setIsCopied(true);
    toast.success("Summary copied to clipboard!");
    setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  };

  const handleDownloadSummaryWord = () => {
    if (summaryArticles.length === 0 && !summaryTextOutput) {
      toast.error("No summary content available to download.");
      return;
    }
    const itemsToDownload = summaryArticles.length > 0 
      ? summaryArticles 
      : [{
          headline: "Factual Summary Report",
          summary: summaryTextOutput,
          sourceLink: ""
        }];
    generateAndDownloadSummaryWordDoc(itemsToDownload, "News_Summaries_Report");
    toast.success("Downloaded news summaries in Word format!");
  };

  const handleClearSummarize = () => {
    setSummaryTextInput('');
    setSummaryFileName('');
    setSummaryTextOutput('');
    setSummaryArticles([]);
    toast.success("Inputs and generated summary cleared!");
  };

  // Computed dynamic stats based on current result.items
  const dynamicStats = React.useMemo(() => {
    if (!result) return null;
    const items = result.items;
    
    const countsPerCategory: Record<string, number> = {
      "Corporate": 0,
      "Electrification": 0,
      "New Product": 0,
      "Auto Ancillary": 0,
      "Service": 0,
      "Govt": 0,
      "Global": 0,
    };
    
    items.forEach(item => {
      if (countsPerCategory[item.category] !== undefined) {
        countsPerCategory[item.category]++;
      }
    });

    const flaggedDoubtfulCount = items.filter(item => item.remark && item.remark.trim().length > 0).length;

    return {
      totalShortlisted: items.length,
      countsPerCategory,
      flaggedDoubtfulCount,
    };
  }, [result]);

  const categoryClassName = (category: string) => {
    const slug = category.toLowerCase().replace(/\s+/g, '-');
    return `tag-${slug}`;
  };

  const categoryTextColorClass = (category: string) => {
    const slug = category.toLowerCase().replace(/\s+/g, '-');
    switch (slug) {
      case 'corporate': return 'text-[#1E40AF]';
      case 'electrification': return 'text-[#166534]';
      case 'new-product': return 'text-[#854D0E]';
      case 'auto-ancillary': return 'text-[#6B21A8]';
      case 'service': return 'text-[#991B1B]';
      case 'govt': return 'text-[#9A3412]';
      case 'global': return 'text-[#374151]';
      default: return 'text-slate-700';
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-16 bg-navy-dark text-white border-b-4 border-brand-primary shrink-0 z-20">
        <div className="flex items-center justify-between h-full px-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-primary rounded-md flex items-center justify-center font-black text-lg">A</div>
            <div>
              <h1 className="font-bold text-lg leading-none tracking-tight">AutoCuration Hub <span className="font-light opacity-60 text-sm">v4.2</span></h1>
            </div>
          </div>
          <div className="flex items-center gap-6">
             <div className="text-sm opacity-80 hidden md:block">Curator: <span className="font-medium">Senior Curator</span></div>
             <div className="flex items-center gap-2 md:gap-3">
               {/* Export Excel (for Active Curation) */}
               {result && (
                 <Button onClick={handleExport} className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer text-xs">
                   <Download className="w-4 h-4" />
                   Export Excel
                 </Button>
               )}

               {/* Compile Curation Word (Active Curation) */}
               {result && (
                 compilingWord ? (
                   <Button disabled className="h-9 gap-2 bg-blue-600/80 text-white font-semibold text-xs">
                     <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                     Compiling...
                   </Button>
                 ) : (
                   <Button onClick={handleCompileWord} className="hidden h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer text-xs" title="Compile Word document for active curation items instantly">
                     <FileText className="w-4 h-4" />
                     Compile Active Curation
                   </Button>
                 )
               )}
               {/* Compile Live Draft Board (whatever report is progressed till now in Weekly Board) */}
               {weeklyNews.length > 0 && (
                 <>
                   <Button onClick={handleDownloadWeeklyExcel} className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer text-xs" title="Compile Excel spreadsheet">
                     <FileSpreadsheet className="w-4 h-4" />
                     Compile Excel ({weeklyNews.length})
                   </Button>
                   <Button onClick={handleDownloadWeeklyWord} className="h-9 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer text-xs" title="Compile Word document">
                     <Download className="w-4 h-4 animate-bounce-subtle" />
                     Compile Word ({weeklyNews.length})
                   </Button>
                 </>
               )}
             </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-navy-muted border-r border-navy-hover flex flex-col shrink-0">
          <div className="flex-1 py-6 px-4 space-y-8 overflow-y-auto">
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#64748B] px-4 mb-3">Main Tasks</p>

              <div 
                onClick={() => setActiveView('curate')}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm cursor-pointer transition-colors font-medium",
                  activeView === 'curate' ? "bg-navy-hover text-white border-l-4 border-brand-primary rounded-l-none font-semibold" : "text-navy-text hover:bg-navy-hover hover:text-white"
                )}
              >
                <Upload className="w-4 h-4" />
                Active Curation
              </div>

              <div 
                onClick={() => setActiveView('weekly')}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm cursor-pointer transition-colors font-medium relative",
                  activeView === 'weekly' ? "bg-navy-hover text-white border-l-4 border-brand-primary rounded-l-none font-semibold" : "text-navy-text hover:bg-navy-hover hover:text-white"
                )}
              >
                <Calendar className="w-4 h-4 text-emerald-500" />
                <span>Weekly Draft Board</span>
                {weeklyNews.length > 0 && (
                  <Badge className="absolute right-3 bg-brand-primary text-white text-[10px] scale-90 px-1.5 py-0">
                    {weeklyNews.length}
                  </Badge>
                )}
              </div>
              <div 
                onClick={() => setActiveView('summarize')}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm cursor-pointer transition-colors font-medium",
                  activeView === 'summarize' ? "bg-navy-hover text-white border-l-4 border-brand-primary rounded-l-none font-semibold" : "text-navy-text hover:bg-navy-hover hover:text-white"
                )}
              >
                <FileText className="w-4 h-4" />
                Summarize Text
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-navy-text hover:bg-navy-hover hover:text-white cursor-not-allowed opacity-50">
                <FileSpreadsheet className="w-4 h-4" />
                SOP Knowledge Base
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-navy-text hover:bg-navy-hover hover:text-white cursor-not-allowed opacity-50">
                <ExternalLink className="w-4 h-4" />
                Archive & History
              </div>
            </div>

            <div className="pt-2 border-t border-navy-hover/30 px-2">
              <Button 
                variant="outline" 
                onClick={handleClearWeeklyCollation}
                className="w-full text-xs text-rose-400 hover:text-white border-rose-500/25 hover:bg-rose-600 hover:border-rose-500 font-bold transition-all flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rose-500/[0.04] cursor-pointer shadow-xs"
                title="Completely reset the current compilation week, clearing all draft news items, reports, and resetting dates."
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset Action Week
              </Button>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#64748B] px-4 mb-3">Config</p>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-navy-text hover:bg-navy-hover hover:text-white cursor-not-allowed opacity-50">
                <AlertCircle className="w-4 h-4" />
                Category Rules
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-navy-text hover:bg-navy-hover hover:text-white cursor-not-allowed opacity-50">
                <ChevronRight className="w-4 h-4" />
                Text Filters
              </div>
            </div>
          </div>
          <div className="p-5 bg-navy-dark border-t border-navy-hover">
            <p className="text-[11px] text-[#64748B] leading-relaxed">
              Applying SOP V3.1 - Standard Replacements Active (Rs. → INR, percent → %)
            </p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {activeView === 'curate' && (
            <>
              {!result && !processing && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full content-start"
                >
                  <div className="lg:col-span-2 space-y-6">
                    <Card className="rounded-xl border-border-slate shadow-sm">
                      <CardHeader className="bg-[#FAFBFC] border-b border-border-slate flex flex-row items-center justify-between py-4">
                        <CardTitle className="text-sm font-bold flex items-center gap-2">
                           <Upload className="w-4 h-4 text-brand-primary" />
                           Data Input & Extracted Text
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-6">
                        {!file ? (
                          <div className="space-y-4">
                            <div 
                              {...getRootProps()} 
                              className={cn(
                                "h-[280px] flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer transition-all bg-[#F8FAFC] hover:bg-slate-50",
                                isDragActive ? "border-brand-primary bg-primary/5" : "border-[#CBD5E1]"
                              )}
                            >
                              <input {...getInputProps()} />
                              <div className="text-4xl mb-4">📄</div>
                              <h3 className="text-sm font-bold text-navy-dark leading-none pb-1">Upload NURC Raw File</h3>
                              <p className="text-xs text-[#64748B]">ZIP, PDF, DOCX, XLSX, TXT, HTML, PNG or JPG accepted</p>
                            </div>
                            
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs text-[#64748B]">or</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const dummyFile = new File([''], 'manual_text_input.txt', { type: 'text/plain' });
                                  setFile(dummyFile);
                                  setRawUploadedText('');
                                }}
                                className="h-8 text-xs font-bold border-brand-primary text-brand-primary hover:bg-brand-primary/5 transition-all flex items-center gap-1.5"
                              >
                                <Edit className="w-3.5 h-3.5" />
                                Type / Paste Raw Text Directly
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#F8FAFC] border border-slate-200 p-3.5 rounded-xl">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <span className="text-xs font-bold text-[#64748B] shrink-0">Source Stream:</span>
                                <Badge variant="secondary" className="px-2 py-0.5 text-xs text-brand-primary bg-primary/10 border-brand-primary/20 truncate font-semibold">
                                  {file.name}
                                </Badge>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setFile(null);
                                  setImageInlineData(null);
                                  setRawUploadedText('');
                                  setResult(null);
                                }}
                                className="h-8 text-xs text-red-500 hover:bg-red-50 hover:text-red-650 px-3 font-semibold shrink-0"
                              >
                                ✖ Clear / Load Another
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-bold uppercase tracking-wide text-[#64748B] flex items-center gap-1.5">
                                  <Edit className="w-3.5 h-3.5 text-brand-primary" />
                                  Edit File Context & Content:
                                </label>
                                <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                  {rawUploadedText?.length || 0} chars
                                </span>
                              </div>

                              {parsingFile ? (
                                <div className="h-[260px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-slate-400 text-xs">
                                  <Loader2 className="w-7 h-7 animate-spin text-brand-primary mb-2.5" />
                                  <span className="font-semibold text-slate-500 animate-pulse-subtle">Extracting and parsing file structure...</span>
                                </div>
                              ) : (
                                <textarea
                                  value={rawUploadedText}
                                  onChange={(e) => setRawUploadedText(e.target.value)}
                                  className="w-full h-[260px] p-4 text-xs md:text-sm text-navy-dark bg-white border border-slate-200 hover:border-slate-300 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary rounded-xl outline-none transition-colors shadow-inner-sm resize-y leading-relaxed font-sans"
                                  placeholder="Type, edit or paste the raw automotive text here... This is the target context standard curation is performed against."
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    <Button 
                      className="w-full h-12 bg-brand-primary hover:bg-brand-primary/90 text-white font-bold text-base shadow-lg cursor-pointer transition-all disabled:opacity-50" 
                      disabled={!file || parsingFile}
                      onClick={handleProcess}
                    >
                      {processing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin mr-2" />
                          <span>Curating {Math.round(progress)}% ...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5 mr-2" />
                          <span>Start Auto-Curation Scan</span>
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="space-y-6">
                    <Card className="rounded-xl border-border-slate shadow-sm">
                      <CardHeader className="bg-[#FAFBFC] border-b border-border-slate py-4">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-[#64748B]">Guidelines</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-6 space-y-4">
                        {[
                          "Focus on Indian automotive expansions & JVs.",
                          "Prioritize EV-related news across all segments.",
                          "Exclude sales figures, C-suite & opinions."
                        ].map((text, i) => (
                          <div key={i} className="flex gap-3 items-start">
                            <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="w-3 h-3 text-green-600" />
                            </div>
                            <span className="text-sm text-navy-muted leading-snug">{text}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </motion.div>
              )}

              {processing && (
                <div className="h-full flex items-center justify-center">
                  <div className="max-w-md w-full text-center space-y-8 p-10 bg-white rounded-2xl shadow-xl border border-border-slate">
                    <div className="relative inline-block">
                      <div className="w-20 h-20 rounded-full border-4 border-slate-100 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-brand-primary animate-spin" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold tracking-tight">Analyzing Intelligence...</h2>
                      <p className="text-[#64748B] text-sm">Applying SOP V3.1 and filtering raw data</p>
                    </div>
                    <div className="space-y-2">
                       <Progress value={progress} className="h-2 bg-slate-100 [&>div]:bg-brand-primary" />
                       <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{Math.round(progress)}% Processed</p>
                    </div>
                  </div>
                </div>
              )}

              {result && (
                <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
                  <div className="lg:col-span-2 flex flex-col overflow-hidden">
                    <Card className="flex-1 flex flex-col rounded-xl border-border-slate shadow-sm overflow-hidden">
                      <CardHeader className="bg-[#FAFBFC] border-b border-border-slate flex flex-col md:flex-row md:items-center justify-between gap-4 py-4 px-6 shrink-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-brand-primary" />
                            <CardTitle className="text-sm font-bold">
                              Live Curation Queue
                            </CardTitle>
                          </div>
                          <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded border border-slate-200 shadow-xs">
                            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Batch Date:</span>
                            <input
                              type="date"
                              value={result.items[0]?.date || ""}
                              onChange={(e) => handleUpdateBatchDate(e.target.value)}
                              className="text-xs font-semibold bg-transparent border-none outline-none text-[#1E293B] cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCurationResetConfirm(true)}
                            className="h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold transition-all px-2.5 rounded-lg flex items-center gap-1.5 cursor-pointer text-xs border border-transparent hover:border-rose-100"
                            title="Reset and discard all news curation batch data"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Reset Data
                          </Button>

                          {/* View Mode Switching Slider Tabs */}
                          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
                          <button
                            onClick={() => setQueueViewMode('table')}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all outline-none",
                              queueViewMode === 'table' ? "bg-white text-brand-primary shadow-xs" : "text-[#64748B] hover:text-navy-dark"
                            )}
                          >
                            <List className="w-3.5 h-3.5 animate-pulse-subtle" />
                            List Mode
                          </button>
                          <button
                            onClick={() => setQueueViewMode('slider')}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all outline-none",
                              queueViewMode === 'slider' ? "bg-white text-brand-primary shadow-xs" : "text-[#64748B] hover:text-navy-dark"
                            )}
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            Slider Mode
                          </button>
                        </div>
                      </div>
                    </CardHeader>

                      {queueViewMode === 'slider' ? (
                        <div className="flex-1 flex flex-col justify-between p-6 bg-white overflow-hidden">
                          {result.items.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#64748B] min-h-[250px]">
                              <span className="text-4xl mb-2">📭</span>
                              <h4 className="text-sm font-bold text-navy-dark">No headlines in queue</h4>
                              <p className="text-xs mt-1">Click "+ Add New Headline Row" to insert a new news item</p>
                            </div>
                          ) : (() => {
                            const resolvedIdx = Math.min(activeSliderIndex, result.items.length - 1);
                            const item = result.items[resolvedIdx] || result.items[0];
                            return (
                              <div className="flex-1 flex flex-col justify-between gap-6 overflow-hidden">
                                <div className="flex-1 flex gap-6 items-stretch overflow-hidden">
                                  {/* Left Slide Details Container */}
                                  <div className="flex-1 flex flex-col justify-between gap-5 min-h-0 overflow-y-auto pr-1">
                                    <AnimatePresence mode="wait">
                                      <motion.div
                                        key={item.id || resolvedIdx}
                                        initial={{ opacity: 0, scale: 0.99, y: 5 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.99, y: -5 }}
                                        transition={{ duration: 0.15 }}
                                        className="space-y-5 flex-1 flex flex-col justify-between"
                                      >
                                        {/* Params Settings Row */}
                                        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-100 shrink-0">
                                          <div className="flex items-center gap-4">
                                            {/* Side Dropdown */}
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">SIDE:</span>
                                              <div className="relative inline-block w-[135px]">
                                                <select
                                                  value={item.side}
                                                  onChange={(e) => handleUpdateItemSide(resolvedIdx, e.target.value as "l" | "r")}
                                                  className="appearance-none pl-3.5 pr-8 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-primary outline-none cursor-pointer w-full transition-all text-left uppercase"
                                                  style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                                                >
                                                  <option value="l">LEFT (L)</option>
                                                  <option value="r">RIGHT (R)</option>
                                                </select>
                                                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-slate-500">
                                                  <ChevronDown className="w-3.5 h-3.5" />
                                                </div>
                                              </div>
                                            </div>

                                            {/* Category Selector */}
                                            <div className="flex items-center gap-2">
                                              <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">CATEGORY:</span>
                                              <div className="relative inline-block w-[165px]">
                                                <select
                                                  value={item.category}
                                                  onChange={(e) => handleUpdateItemCategory(resolvedIdx, e.target.value as any)}
                                                  className={cn(
                                                    "appearance-none pl-3 pr-7 py-1.5 rounded-lg text-xs font-extrabold uppercase border border-transparent cursor-pointer outline-none w-full shadow-xs transition-all relative z-10 bg-transparent text-left truncate flex items-center justify-between",
                                                    categoryClassName(item.category)
                                                  )}
                                                  style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                                                >
                                                  <option value="Corporate" className="bg-white text-blue-800 font-sans normal-case font-semibold">Corporate</option>
                                                  <option value="Electrification" className="bg-white text-green-800 font-sans normal-case font-semibold">Electrification</option>
                                                  <option value="New Product" className="bg-white text-yellow-800 font-sans normal-case font-semibold">New Product</option>
                                                  <option value="Auto Ancillary" className="bg-white text-purple-800 font-sans normal-case font-semibold">Auto Ancillary</option>
                                                  <option value="Service" className="bg-white text-red-800 font-sans normal-case font-semibold">Service</option>
                                                  <option value="Govt" className="bg-white text-orange-800 font-sans normal-case font-semibold">Govt</option>
                                                  <option value="Global" className="bg-white text-gray-800 font-sans normal-case font-semibold">Global</option>
                                                </select>
                                                <div className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-20 flex items-center", categoryTextColorClass(item.category))}>
                                                  <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                                                </div>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Delete Headline Slot Button */}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteItem(resolvedIdx)}
                                            className="h-8 gap-1.5 px-3 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-50/50 font-bold transition-all cursor-pointer text-xs"
                                            title="Delete Headline Slot"
                                          >
                                            <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                                            <span>Delete Headline Slot</span>
                                          </Button>
                                        </div>

                                        {/* Headline Entry Area Box with Exact styling */}
                                        <div className="space-y-2 flex-1 flex flex-col justify-start">
                                          <span className="text-[11px] font-extrabold text-indigo-600 uppercase tracking-widest leading-none">News Headline Content (Shortlisted)</span>
                                          <div className="border-2 border-indigo-100 bg-indigo-50/10 hover:bg-white hover:border-indigo-200 rounded-2xl p-6 shadow-xs focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all flex flex-col flex-1 min-h-[140px]">
                                            <textarea
                                              value={item.news}
                                              onChange={(e) => handleUpdateItemNews(resolvedIdx, e.target.value)}
                                              rows={3}
                                              className="text-lg md:text-xl font-bold text-slate-950 leading-snug tracking-tight w-full border-none outline-none resize-none bg-transparent flex-1 focus:ring-0 focus:outline-none p-0 focus-visible:ring-0 placeholder:text-slate-400"
                                              placeholder="Enter news headline..."
                                            />
                                          </div>
                                        </div>

                                        {/* Narrative / Full Content Box */}
                                        <div className="space-y-1.5 flex-1 flex flex-col justify-start mt-1">
                                          <span className="text-[10px] font-extrabold text-[#64748B] uppercase tracking-widest leading-none">Narrative Description Body</span>
                                          <div className="border border-slate-200 bg-white hover:border-slate-300 rounded-2xl p-4 shadow-sm focus-within:border-brand-primary focus-within:ring-1 focus-within:ring-brand-primary/20 transition-all flex flex-col flex-1 min-h-[100px]">
                                            <textarea
                                              value={item.fullText || ""}
                                              onChange={(e) => handleUpdateItemFullText(resolvedIdx, e.target.value)}
                                              rows={3}
                                              className="text-sm text-slate-600 leading-relaxed w-full border-none outline-none resize-none bg-transparent flex-1 focus:ring-0 focus:outline-none p-0 focus-visible:ring-0 font-serif"
                                              placeholder="Narrative description body story..."
                                            />
                                          </div>
                                        </div>

                                        {/* Source Link Input */}
                                        <div className="space-y-1.5 mt-1">
                                          <span className="text-[10px] font-extrabold text-[#64748B] uppercase tracking-widest leading-none">Source Link</span>
                                          <input
                                            type="text"
                                            value={item.sourceLink || ""}
                                            onChange={(e) => handleUpdateItemSourceLink(resolvedIdx, e.target.value)}
                                            className="text-xs text-blue-600 bg-white border border-slate-200 hover:border-slate-300 focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20 py-2 px-3 rounded-xl w-full outline-none transition-all shadow-xs"
                                            placeholder="Source URL link (e.g., https://...)"
                                          />
                                        </div>

                                        {/* Tags Container Directly under */}
                                        <div className="flex flex-wrap items-center gap-2 mt-2">
                                          <span className="text-[10px] text-[#64748B] font-extrabold uppercase bg-slate-100 border border-transparent rounded px-2.5 py-1 inline-flex items-center tracking-wider shrink-0">
                                            D-MMM DATE: {formatToDMMM(item.date).toUpperCase()}
                                          </span>
                                          <div className="relative inline-flex items-center w-full max-w-[320px]">
                                            <input
                                              type="text"
                                              placeholder="Add dynamic remark..."
                                              value={item.remark || ""}
                                              onChange={(e) => handleUpdateItemRemark(resolvedIdx, e.target.value)}
                                              className="text-[11px] font-extrabold text-[#854D0E] bg-amber-50/40 border border-amber-200 hover:border-amber-300 focus:border-amber-400 focus:bg-white py-1 px-3 rounded-lg w-full outline-none transition-all placeholder:text-[#B45309]/50"
                                            />
                                          </div>
                                        </div>
                                      </motion.div>
                                    </AnimatePresence>
                                  </div>

                                  {/* Right Vertical Scroll-Slider Navigation Bar */}
                                  <div className="w-[38px] flex flex-col items-center justify-between py-2 border border-slate-200 bg-slate-50 rounded-xl shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setActiveSliderIndex(prev => Math.max(0, prev - 1))}
                                      disabled={resolvedIdx === 0}
                                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-all cursor-pointer disabled:pointer-events-none"
                                      title="Previous Headline"
                                    >
                                      <ChevronUp className="w-5 h-5 stroke-[2.5]" />
                                    </button>

                                    {/* Scroll Track & Thumb */}
                                    <div className="flex-1 w-full flex justify-center items-center py-4 relative">
                                      {/* Outer track line */}
                                      <div className="absolute top-2 bottom-2 w-1.5 bg-slate-200 rounded-full" />
                                      
                                      {/* Custom indicator track that moves vertically! */}
                                      {result.items.length > 1 ? (
                                        <div 
                                          className="w-3 bg-slate-400 hover:bg-slate-600 rounded-full cursor-pointer absolute transition-all duration-300 active:scale-105 shadow-sm"
                                          style={{
                                            height: '28px',
                                            top: `${result.items.length > 1 ? (resolvedIdx / (result.items.length - 1)) * 82 : 0}%`, 
                                            transform: 'translateY(10%)'
                                          }}
                                          title={`Headline ${resolvedIdx + 1} of ${result.items.length}`}
                                        />
                                      ) : (
                                        <div className="w-3 h-7 bg-slate-300 rounded-full absolute top-2" />
                                      )}
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() => setActiveSliderIndex(prev => Math.min(result.items.length - 1, prev + 1))}
                                      disabled={resolvedIdx === result.items.length - 1}
                                      className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 transition-all cursor-pointer disabled:pointer-events-none"
                                      title="Next Headline"
                                    >
                                      <ChevronDown className="w-5 h-5 stroke-[2.5]" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                          <Table>
                            <TableHeader className="bg-slate-50/80 sticky top-0 z-10 font-sans">
                              <TableRow className="hover:bg-transparent border-b border-border-slate">
                                <TableHead className="w-[160px] text-xs font-bold uppercase text-[#64748B] tracking-wider">CATEGORY</TableHead>
                                <TableHead className="text-xs font-bold uppercase text-[#64748B] tracking-wider">HEADLINE</TableHead>
                                <TableHead className="w-[140px] text-center text-xs font-bold uppercase text-[#64748B] tracking-wider">SIDE</TableHead>
                                <TableHead className="w-[120px] text-center text-xs font-bold uppercase text-[#64748B] tracking-wider">ACTION</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.items.map((item, idx) => {
                                return (
                                  <TableRow key={idx} className="border-b border-slate-100 transition-colors hover:bg-slate-50/30">
                                    <TableCell className="align-middle py-4 px-4">
                                      <div className="relative inline-block w-full max-w-[155px]">
                                        <select
                                          value={item.category}
                                          onChange={(e) => handleUpdateItemCategory(idx, e.target.value as any)}
                                          className={cn(
                                            "appearance-none pl-3 pr-7 py-2 rounded-lg text-[11px] font-extrabold uppercase border border-transparent cursor-pointer outline-none w-full shadow-xs transition-all relative z-10 bg-transparent text-left truncate flex items-center justify-between",
                                            categoryClassName(item.category)
                                          )}
                                          style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                                        >
                                          <option value="Corporate" className="bg-white text-blue-800 font-sans normal-case font-semibold">Corporate</option>
                                          <option value="Electrification" className="bg-white text-green-800 font-sans normal-case font-semibold">Electrification</option>
                                          <option value="New Product" className="bg-white text-yellow-800 font-sans normal-case font-semibold">New Product</option>
                                          <option value="Auto Ancillary" className="bg-white text-purple-800 font-sans normal-case font-semibold">Auto Ancillary</option>
                                          <option value="Service" className="bg-white text-red-800 font-sans normal-case font-semibold">Service</option>
                                          <option value="Govt" className="bg-white text-orange-800 font-sans normal-case font-semibold">Govt</option>
                                          <option value="Global" className="bg-white text-gray-800 font-sans normal-case font-semibold">Global</option>
                                        </select>
                                        <div className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none z-20 flex items-center", categoryTextColorClass(item.category))}>
                                          <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-4 px-4 font-sans text-left">
                                      <textarea
                                        value={item.news}
                                        onChange={(e) => {
                                          handleUpdateItemNews(idx, e.target.value);
                                          e.target.style.height = "auto";
                                          e.target.style.height = e.target.scrollHeight + "px";
                                        }}
                                        ref={(el) => {
                                          if (el) {
                                            el.style.height = "auto";
                                            el.style.height = el.scrollHeight + "px";
                                          }
                                        }}
                                        rows={1}
                                        className="text-base font-bold text-slate-900 leading-snug w-full px-2 py-1.5 border border-transparent hover:border-indigo-100 focus:border-[#CBD5E1] rounded-lg resize-none bg-transparent hover:bg-white focus:bg-white transition-all outline-none overflow-hidden placeholder:text-slate-400"
                                        placeholder="Enter news headline..."
                                      />
                                      <div className="flex flex-wrap items-center gap-2 mt-2 px-1">
                                        <span className="text-[10px] text-[#64748B] font-bold uppercase bg-[#E2E8F0]/50 border border-transparent rounded px-2.5 py-1 inline-flex items-center tracking-wider shrink-0">
                                          D-MMM DATE: {formatToDMMM(item.date).toUpperCase()}
                                        </span>
                                        <div className="relative inline-flex items-center w-full max-w-[280px]">
                                          <input
                                            type="text"
                                            placeholder="Add dynamic remark..."
                                            value={item.remark || ""}
                                            onChange={(e) => handleUpdateItemRemark(idx, e.target.value)}
                                            className="text-[11px] font-semibold text-[#854D0E] bg-amber-50/40 border border-amber-200 hover:border-amber-300 focus:border-amber-400 focus:bg-white py-1 px-3 rounded-lg w-full outline-none transition-all"
                                          />
                                        </div>
                                      </div>

                                      {/* Narrative Description Box */}
                                      <div className="mt-2.5 px-1 space-y-1">
                                        <span className="text-[9px] text-[#64748B] font-extrabold uppercase tracking-wider block">Narrative Description Body:</span>
                                        <textarea
                                          value={item.fullText || ""}
                                          onChange={(e) => handleUpdateItemFullText(idx, e.target.value)}
                                          rows={2}
                                          className="text-xs text-slate-600 leading-relaxed w-full px-2 py-1 border border-transparent hover:border-slate-200 focus:border-[#CBD5E1] rounded bg-slate-50/50 hover:bg-white focus:bg-white transition-all outline-none resize-none font-serif"
                                          placeholder="Add narrative description body story..."
                                        />
                                      </div>

                                      {/* Source Link Input */}
                                      <div className="mt-2 px-1 flex items-center gap-1.5 bg-slate-50/50 border border-slate-100 rounded hover:border-slate-200 focus-within:border-[#CBD5E1] focus-within:bg-white transition-all">
                                        <span className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider whitespace-nowrap pl-1.5">Link:</span>
                                        <input
                                          type="text"
                                          value={item.sourceLink || ""}
                                          onChange={(e) => handleUpdateItemSourceLink(idx, e.target.value)}
                                          className="text-[11px] text-blue-600 bg-transparent border-none outline-none py-1.5 px-1 flex-1 font-sans"
                                          placeholder="No source link extracted..."
                                        />
                                      </div>
                                    </TableCell>
                                    <TableCell className="align-middle text-center py-4 px-4">
                                      <div className="relative inline-block w-full max-w-[125px]">
                                        <select
                                          value={item.side}
                                          onChange={(e) => handleUpdateItemSide(idx, e.target.value as "l" | "r")}
                                          className="appearance-none pl-3.5 pr-8 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-primary outline-none cursor-pointer hover:border-slate-300 w-full transition-all text-left uppercase"
                                          style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                                        >
                                          <option value="l">LEFT (L)</option>
                                          <option value="r">RIGHT (R)</option>
                                        </select>
                                        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center text-slate-500">
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="align-middle text-center py-4 px-4">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteItem(idx)}
                                        className="h-9 gap-1.5 px-3 text-slate-400 hover:text-red-500 hover:bg-red-50/50 rounded-lg font-bold transition-all mx-auto flex items-center justify-center cursor-pointer group"
                                        title="Delete Headline"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-red-500 transition-colors" />
                                        <span className="text-slate-400 group-hover:text-red-500 transition-colors">Delete</span>
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      <div className="p-4 bg-slate-50 border-t border-border-slate flex justify-between items-center shrink-0">
                        <div className="flex gap-2">
                          <Button 
                            onClick={handleAddItem}
                            variant="outline"
                            className="text-xs h-9 border-dashed border-2 hover:border-brand-primary hover:text-brand-primary hover:bg-brand-primary/5 transition-all font-semibold"
                          >
                            + Add New Headline Row
                          </Button>
                          <Button 
                            onClick={handleOpenImportDialog}
                            className="text-xs h-9 bg-[#0EA5E9] hover:bg-[#0284C7] text-white font-bold gap-1.5 shadow cursor-pointer transition-colors"
                          >
                            <Calendar className="w-4 h-4" />
                            Send to Weekly Tracker
                          </Button>
                        </div>
                        <p className="text-[11px] font-medium text-[#64748B]">
                          {result.items.length} items in batch queue
                        </p>
                      </div>
                    </Card>
                  </div>

                  <div className="flex flex-col gap-6 overflow-hidden">
                    {/* Category Inclusion Breakdown Card */}
                    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-sm p-6 space-y-6 overflow-y-auto custom-scrollbar max-h-[380px] shrink-0">
                       {Object.entries(dynamicStats?.countsPerCategory || {}).map(([cat, count], i) => (
                         <div key={cat} className="space-y-2">
                           <div className="flex justify-between items-center text-xs font-bold text-[#0F172A]/80">
                             <span>{cat}</span>
                             <span className="text-xs font-black text-[#0F172A]">{count} items</span>
                           </div>
                           <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                             <div 
                               className="h-full transition-all duration-1000 rounded-full" 
                               style={{ 
                                 width: `${result.items.length > 0 ? ((count as number) / result.items.length) * 100 : 0}%`, 
                                 backgroundColor: count === 0 ? '#E2E8F0' : (i % 2 === 0 ? '#10B981' : '#F59E0B') 
                               }}
                             />
                           </div>
                         </div>
                       ))}
                    </Card>

                    {/* Discard & Clear Batch Button */}
                    <Button 
                      onClick={() => {setResult(null); setFile(null); setImageInlineData(null); setRawUploadedText('');}} 
                      className="w-full h-14 bg-white hover:bg-slate-50 border-2 border-dashed border-slate-200/80 hover:border-slate-300 rounded-2xl font-bold text-[#0F172A] flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-xs shrink-0"
                    >
                      <Trash2 className="w-4 h-4 text-[#0F172A]" />
                      Discard & Clear Batch
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeView === 'summarize' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full content-start"
            >
              <div className="lg:col-span-2 space-y-6">
                <Card className="rounded-xl border-border-slate shadow-sm">
                  <CardHeader className="bg-[#FAFBFC] border-b border-border-slate flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-6">
                    <div>
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <FileText className="w-4 h-4 text-brand-primary" />
                        Raw Text Input
                      </CardTitle>
                      <CardDescription className="text-xs text-[#64748B] mt-1">
                        Paste articles, newsletters, or raw text transcripts to summarize with high factual fidelity.
                      </CardDescription>
                    </div>
                    {(summaryTextInput || summaryTextOutput) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearSummarize}
                        className="h-8 text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg px-2.5 flex items-center gap-1.5 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {/* File Dropzone */}
                    <div 
                      {...getSummaryRootProps()} 
                      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                        isSummaryDragActive 
                          ? "border-brand-primary bg-brand-primary/5" 
                          : "border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <input {...getSummaryInputProps()} />
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <div className="p-2.5 bg-blue-50 text-blue-600 rounded-full">
                          {summarizingFile ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Upload className="w-5 h-5" />
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-navy-dark">
                            {summarizingFile ? "Reading and parsing document..." : "Click to upload or drag & drop any file"}
                          </p>
                          <p className="text-[10px] text-[#64748B] mt-1">
                            Supports DOCX, PDF, XLSX, TXT, HTML, CSV, JSON, ZIP, images, etc. fallback to text extraction.
                          </p>
                        </div>
                      </div>
                    </div>

                    {summaryTextInput && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-md">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-navy-dark truncate max-w-[180px] sm:max-w-[300px]">
                                {summaryFileName || "Extracted Document Content"}
                              </p>
                              <p className="text-[10px] text-slate-400 font-medium">
                                {summaryTextInput.trim() ? summaryTextInput.trim().split(/\s+/).length : 0} words parsed
                              </p>
                            </div>
                          </div>
                          <Button 
                            onClick={handleClearSummarize} 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 text-[11px] font-bold text-red-500 hover:text-red-700 hover:bg-red-50 rounded px-2"
                          >
                            Remove File
                          </Button>
                        </div>
                        <div className="border border-slate-100 bg-slate-50/30 rounded-lg p-4 max-h-[220px] overflow-y-auto custom-scrollbar text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap text-justify">
                          {summaryTextInput}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  onClick={handleSummarize}
                  className="w-full h-12 bg-brand-primary hover:bg-brand-primary/90 text-white font-bold text-base shadow-lg flex items-center justify-center gap-2" 
                  disabled={summarizing || !summaryTextInput.trim()}
                >
                  {summarizing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing and Summarizing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate 3-4 Liner Paragraph Summary
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-6">
                <Card className="rounded-xl border-border-slate shadow-sm h-full flex flex-col overflow-hidden">
                  <CardHeader className="bg-[#FAFBFC] border-b border-border-slate py-4 px-6 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-[#64748B]">Factual Summary</CardTitle>
                    {summaryTextOutput && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopySummary}
                          className="h-8 gap-2 hover:border-brand-primary hover:text-brand-primary hover:bg-brand-primary/5 font-semibold transition-all text-xs"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          {isCopied ? "Copied!" : "Copy"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadSummaryWord}
                          className="h-8 gap-2 border-blue-200 text-blue-700 bg-blue-50/30 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-800 font-semibold transition-all text-xs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download Word (.docx)
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  
                  <CardContent className="flex-1 p-6 flex flex-col justify-center min-h-[300px]">
                    {summarizing ? (
                      <div className="flex flex-col items-center justify-center space-y-4 py-12 text-center">
                        <div className="w-12 h-12 rounded-full border-4 border-slate-100 flex items-center justify-center relative">
                          <Loader2 className="w-6 h-6 text-brand-primary animate-spin" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-navy-dark">Distilling key facts...</p>
                          <p className="text-xs text-[#64748B]">Relying strictly on raw content</p>
                        </div>
                      </div>
                    ) : summaryTextOutput ? (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-5 h-full flex flex-col justify-between"
                      >
                        <div className="space-y-6 bg-white border border-slate-100 rounded-xl p-6 shadow-sm max-h-[600px] overflow-y-auto custom-scrollbar">
                          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2.5 py-1 rounded w-fit mb-4">VERIFIED RAW CONTENT</div>
                          
                          {summaryArticles && summaryArticles.length > 0 ? (
                            <div className="space-y-6">
                              {groupedSummaryArticles.map(({ categoryName, articles }) => (
                                <div key={categoryName} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                                  {/* Category Banner with solid teal background exactly like the image */}
                                  <div className="bg-[#3aa68c] text-white font-bold text-[14px] md:text-[15px] px-4 py-2.5 tracking-wide text-left select-none">
                                    {categoryName}
                                  </div>
                                  
                                  {/* Articles list */}
                                  <div className="p-4 space-y-5 divide-y divide-slate-100">
                                    {(articles as any[]).map((art, idx) => {
                                      const combinedText = `${art.headline || ''} ${art.summary || ''} ${art.category || ''}`.toLowerCase();
                                      const isEV = combinedText.includes("electric") || 
                                                   combinedText.includes("ev ") || 
                                                   combinedText.includes(" evs") || 
                                                   combinedText.includes("/ev") || 
                                                   combinedText.includes("electrif") || 
                                                   combinedText.includes("battery") || 
                                                   combinedText.includes("charger") || 
                                                   combinedText.includes("charging") || 
                                                   art.category?.toLowerCase().includes("electrification");

                                      const formattedDate = formatToDDMMMYYYY_Spaced(art.publishDate);
                                      const resolvedSource = formatSourceName(art.sourceName || (art.sourceLink ? "" : "ET Auto"));

                                      return (
                                        <div key={idx} className="space-y-2 pt-4 first:pt-0">
                                          {/* Title / Headline + Electric Vehicle tag inline */}
                                          <div className="flex flex-wrap items-baseline gap-x-1.5 text-left">
                                            {art.sourceLink ? (
                                              <a 
                                                href={art.sourceLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[#1f6d78] hover:text-[#164e56] font-bold text-[14px] md:text-[14.5px] leading-snug hover:underline transition-colors"
                                              >
                                                {art.headline || `News Article ${idx + 1}`}
                                              </a>
                                            ) : (
                                              <span className="text-[#1f6d78] font-bold text-[14px] md:text-[14.5px] leading-snug">
                                                {art.headline || `News Article ${idx + 1}`}
                                              </span>
                                            )}
                                            
                                            {isEV && (
                                              <span className="text-[#ff0000] font-bold text-[11px] whitespace-nowrap ml-1.5 uppercase tracking-wide">
                                                Electric Vehicle
                                              </span>
                                            )}
                                          </div>

                                          {/* Summary Text (Justified like the image) */}
                                          <p className="text-[13px] font-normal text-[#222222] leading-relaxed text-justify">
                                            {art.summary}
                                          </p>

                                          {/* Source Footer precisely on its own line in teal color */}
                                          {(art.publishDate || art.sourceName || art.sourceLink) && (
                                            <p className="text-[11.5px] text-[#1f6d78] font-semibold tracking-tight text-left select-all">
                                              ({formattedDate}, Source: {resolvedSource})
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[13px] font-semibold text-navy-dark leading-relaxed text-justify whitespace-pre-wrap">
                              {summaryTextOutput}
                            </p>
                          )}
                        </div>
                        
                        <div className="pt-2">
                          <div className="flex items-start gap-2 bg-amber-50/50 border border-amber-200/50 text-amber-800 text-[10px] p-3 rounded-lg leading-relaxed font-medium">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <span>
                              <strong className="font-bold">Fact Guarantee:</strong> No external data or interpretations have been injected. Facts are kept 100% raw.
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="text-center py-12 text-[#64748B] flex flex-col items-center justify-center h-full">
                        <span className="text-4xl mb-3">✨</span>
                        <h4 className="text-sm font-bold text-navy-dark">Ready to Summarize</h4>
                        <p className="text-xs text-[#64748B] max-w-xs mt-1 leading-normal">
                          Paste your notes or text on the left to generate a concise 3-4 liner factual summary capturing key information.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          )}

          {activeView === 'weekly' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full content-start"
            >
              {/* Document Draft Left Board Editor - Letter Page Size Simulator */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* WORD DOCUMENT CANVAS SHAPE */}
                <div className="bg-white shadow-xl border border-slate-200 rounded-lg p-10 min-h-[950px] relative text-left">
                  {/* Decorative Word Header */}
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-blue-600 rounded-t-lg" />
                  
                  {/* Title of weekly Newsletter and BCG Vantage Corporate Header Banner */}
                  <div className="bg-black rounded-xl p-8 mb-8 text-white relative overflow-hidden flex flex-col md:flex-row md:items-center md:justify-between gap-6 border-b-4 border-[#00BFA5]">
                    {/* Background decorative effect */}
                    <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-slate-900/50 to-transparent pointer-events-none" />
                    
                    <div className="relative z-10">
                      <div className="text-4xl font-extrabold tracking-tight font-sans text-white">
                        BCG
                      </div>
                      <div className="text-sm font-medium italic text-slate-300 mt-1">
                        India Auto Vantage
                      </div>
                      
                      {/* Styled Turquoise Accent Badge */}
                      <div className="bg-[#00BFA5] text-black text-xs font-black px-4 py-1.5 rounded mt-4 inline-block tracking-wider uppercase">
                        India Auto: Weekly Newsletter
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-3 flex items-center gap-1.5">
                        <span>WEEKLY DRAFT</span>
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[#00BFA5]">{getWeekRangeString(currentFridayDate)}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-3 z-10 shrink-0 self-start md:self-center">
                      {/* Car Headlight Decorative Block mockup */}
                      <div className="hidden sm:flex w-44 h-20 rounded-l-full border-l-4 border-t border-slate-700 bg-slate-950 items-center justify-center shadow-inner">
                        <span className="text-[9px] font-black tracking-[4px] text-slate-500 uppercase select-none">VANTAGE</span>
                      </div>

                      {weeklyNews.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={handleClearWeeklyCollation}
                          className="text-xs text-rose-400 hover:text-rose-300 hover:bg-white/10 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-rose-900/50 transition-all cursor-pointer bg-slate-900/50"
                          title="Completely clear all compiled weekly draft articles"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Reset Board
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Access Instructions Info block */}
                  <div className="bg-amber-50/50 border border-amber-200/50 p-4 rounded-xl mb-8 flex gap-3 text-amber-800">
                    <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-xs space-y-1">
                      <strong className="font-bold">Interactive Micro-Editor Panel:</strong>
                      <p className="leading-relaxed">
                        This reflects the exact layout and sections of your compiled MS Word file. You can **type directly** inside any title, detailed description narrative, or URL link to update and tweak values instantly. Your changes persist automatically in localStorage!
                      </p>
                    </div>
                  </div>

                    {/* 1. TABLE OF CONTENTS INDEX */}
                    <div className="mb-10">
                      <h3 className="text-lg font-bold text-navy-dark border-b border-slate-200 pb-2 mb-4 font-serif">
                        I. Weekly Curated Headlines Index
                      </h3>
                      
                      {/* Visual Guideline Hint */}
                      <div className="bg-indigo-50/50 border border-indigo-100 text-indigo-900 text-xs p-3 rounded-xl mb-4 flex items-center gap-2.5 font-sans leading-relaxed">
                        <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                        <div>
                          <span className="font-bold">Manual Reshuffling:</span> Drag and drop headlines between category blocks below to change their category, or use the quick dropdown selector next to each headline!
                        </div>
                      </div>

                      {/* Interactive Category-Wise Filter Pills */}
                      {weeklyNews.length > 0 && (
                        <div className="mb-6 space-y-2">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">
                            Quick Filter / Check News Category-Wise:
                          </span>
                          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100/70 border border-slate-200/50 rounded-xl">
                            <button
                              onClick={() => setWeeklyCategoryFilter(null)}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                                weeklyCategoryFilter === null
                                  ? "bg-white text-indigo-700 shadow-xs border border-indigo-100 font-extrabold"
                                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-semibold"
                              )}
                            >
                              <span>All Categories</span>
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.2 rounded-full font-sans font-extrabold",
                                weeklyCategoryFilter === null ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-600"
                              )}>
                                {weeklyNews.length}
                              </span>
                            </button>
                            {categoriesSOP.map((cat) => {
                              const count = weeklyNews.filter(item => item.category === cat).length;
                              const isSelected = weeklyCategoryFilter === cat;
                              return (
                                <button
                                  key={cat}
                                  onClick={() => setWeeklyCategoryFilter(cat)}
                                  className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                                    isSelected
                                      ? "bg-white text-indigo-700 shadow-xs border border-indigo-100 font-extrabold"
                                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-semibold"
                                  )}
                                >
                                  <span>{cat}</span>
                                  <span className={cn(
                                    "text-[10px] px-1.5 py-0.2 rounded-full font-sans font-extrabold",
                                    isSelected ? "bg-indigo-50 text-indigo-700" : "bg-slate-200 text-slate-600"
                                  )}>
                                    {count}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {weeklyNews.length === 0 ? (
                        <p className="text-sm italic text-[#64748B] py-4 bg-slate-50 rounded-lg text-center font-serif">
                          No shortlisted headlines in weekly draft yet. Use the "Add News to Board" section on the right to upload files for direct ingestion, or click "Add Custom Story" to type custom headlines manually.
                        </p>
                      ) : (
                        <div className="space-y-6">
                          {categoriesSOP
                            .filter(cat => weeklyCategoryFilter === null || weeklyCategoryFilter === cat)
                            .map((cat, catIdx) => {
                          const itemsInCat = weeklyNews.filter(item => item.category === cat);
                          const isOver = dragOverCategory === cat;
                          return (
                            <div 
                              key={cat} 
                              className={cn(
                                "p-3 rounded-xl transition-all duration-200 border-2",
                                isOver 
                                  ? "bg-emerald-50/60 border-emerald-400 border-dashed" 
                                  : "bg-slate-50/30 border-transparent hover:border-slate-200/50"
                              )}
                              onDragOver={(e) => {
                                e.preventDefault();
                              }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverCategory(cat);
                              }}
                              onDragLeave={() => {
                                if (dragOverCategory === cat) {
                                  setDragOverCategory(null);
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const itemId = e.dataTransfer.getData("text/plain");
                                if (itemId) {
                                  handleUpdateWeeklyItem(itemId, { category: cat });
                                  toast.success(`Successfully reshuffled article to "${cat}"`);
                                }
                                setDraggedItemId(null);
                                setDragOverCategory(null);
                              }}
                            >
                              <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-2">
                                <h4 className="text-sm font-bold text-navy-dark tracking-tight font-serif uppercase flex items-center gap-2">
                                  <span className="text-indigo-600 font-sans text-xs">#{catIdx + 1}</span>
                                  <span>{cat}</span>
                                  <span className="text-[10px] font-sans font-extrabold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                                    {itemsInCat.length} {itemsInCat.length === 1 ? 'item' : 'items'}
                                  </span>
                                </h4>
                              </div>
                              <div className="space-y-2">
                                {itemsInCat.length > 0 ? (
                                  itemsInCat.map((item) => {
                                    const isDayExcluded = excludedWeekdays.includes(item.weekday || 'Saturday');
                                    const isItemExcluded = item.excluded || isDayExcluded;
                                    const isItemDragged = draggedItemId === item.id;
                                    return (
                                      <div 
                                        key={item.id} 
                                        draggable={true}
                                        onDragStart={(e) => {
                                          e.dataTransfer.setData("text/plain", item.id);
                                          setDraggedItemId(item.id);
                                        }}
                                        onDragEnd={() => {
                                          setDraggedItemId(null);
                                          setDragOverCategory(null);
                                        }}
                                        className={cn(
                                          "group flex items-start gap-2.5 p-2 rounded-lg border transition-all cursor-grab active:cursor-grabbing",
                                          isItemDragged ? "opacity-30 border-dashed border-indigo-400 bg-indigo-50/20" : "",
                                          !isItemDragged && isItemExcluded 
                                            ? "bg-slate-50/70 border-slate-200 text-slate-400 opacity-60" 
                                            : "bg-white border-slate-100 hover:border-slate-300 hover:shadow-2xs text-slate-800"
                                        )}
                                      >
                                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                          {/* Draggable grab handle */}
                                          <div className="text-slate-300 group-hover:text-slate-400 transition-colors cursor-grab active:cursor-grabbing p-0.5" title="Drag to reshuffle category">
                                            <Sliders className="w-3.5 h-3.5" />
                                          </div>
                                          <input
                                            type="checkbox"
                                            checked={!item.excluded && !isDayExcluded}
                                            disabled={isDayExcluded}
                                            onChange={() => handleToggleWeeklyItemExcluded(item.id)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-primary focus:ring-brand-primary cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                            title={isDayExcluded ? "To include this story, enable its weekday in the Friday tracker panel first" : "Toggle story exclusion"}
                                          />
                                        </div>
                                        <div 
                                          className="flex-1 text-xs font-serif leading-relaxed select-none cursor-pointer"
                                          onClick={() => !isDayExcluded && handleToggleWeeklyItemExcluded(item.id)}
                                        >
                                          <span className={cn(
                                            "font-medium block mb-1",
                                            isItemExcluded ? "line-through text-slate-400 font-normal bg-slate-100/50" : "text-[#1E293B]"
                                          )}>
                                            {item.news}
                                          </span>
                                          
                                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5 font-sans">
                                            {item.isEV && (
                                              <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-150 px-1 py-0.2 rounded font-bold shrink-0">
                                                ⚡ EV
                                              </span>
                                            )}
                                            <span className="text-[9px] bg-slate-100 text-slate-500 border border-slate-200 px-1 py-0.2 rounded font-semibold shrink-0">
                                              📅 {item.weekday}
                                            </span>
                                            {item.excluded && !isDayExcluded && (
                                              <span className="text-[9px] bg-rose-50 text-rose-600 border border-rose-100 px-1 py-0.2 rounded font-bold shrink-0 animate-pulse">
                                                🛑 OMITTED FROM EXPORT
                                              </span>
                                            )}
                                            {isDayExcluded && (
                                              <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1 py-0.2 rounded font-bold shrink-0">
                                                ⚠️ DAY EXCLUDED
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        {/* Actions & Dropdown Reshuffler */}
                                        <div className="opacity-0 group-hover:opacity-100 transition-all flex items-center gap-2 shrink-0 self-center">
                                          <select
                                            value={item.category}
                                            onChange={(e) => {
                                              const newCat = e.target.value;
                                              handleUpdateWeeklyItem(item.id, { category: newCat });
                                              toast.success(`Successfully moved article to "${newCat}"`);
                                            }}
                                            className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-bold cursor-pointer outline-none hover:border-slate-300 transition-colors text-slate-600 font-sans"
                                            title="Move category manually"
                                          >
                                            {categoriesSOP.map(c => (
                                              <option key={c} value={c}>{c}</option>
                                            ))}
                                          </select>

                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setItemToDelete({ id: item.id, headline: item.news });
                                            }}
                                            className="text-[#94A3B8] hover:text-rose-600 transition-colors p-1 cursor-pointer"
                                            title="Delete news story permanently"
                                          >
                                            <Trash2 className="w-3.5 h-3.5 text-rose-500 hover:text-rose-700" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-[10.5px] italic text-slate-400 p-3.5 border border-dashed border-slate-200 rounded-lg text-center bg-slate-50/20 font-sans">
                                    No articles in this category. Drag and drop any headline card here to allocate!
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* PAGE BREAK INDICATOR */}
                  <div className="relative py-8 my-10 flex items-center justify-center shrink-0">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-dashed border-slate-300" />
                    </div>
                    <span className="relative bg-white px-3 text-[10px] uppercase font-bold tracking-widest text-[#94A3B8]">
                      --- PAGE BREAK - START DOCUMENT SECTIONS ---
                    </span>
                  </div>

                  {/* 2. MAIN NEWS BODY SECTION */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2 mb-6">
                      <h3 className="text-lg font-bold text-navy-dark font-serif">
                        II. Detailed News Reports
                      </h3>
                      {weeklyNews.length > 0 && (
                        <Button
                          size="sm"
                          onClick={handleAutoExtractFromDailyFiles}
                          disabled={extractingRawFiles}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm cursor-pointer transition-all"
                          title="Extract full verbatim story text below headlines for all articles on the board"
                        >
                          {extractingRawFiles ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Extracting Verbatim Narratives...</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Extract Full Content Below Headlines</span>
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {weeklyNews.length === 0 ? (
                      <p className="text-sm italic text-[#64748B] py-8 text-center font-serif">
                        No detailed reports found.
                      </p>
                    ) : (
                      <div className="space-y-8 font-serif">
                        {categoriesSOP
                          .filter(cat => weeklyCategoryFilter === null || weeklyCategoryFilter === cat)
                          .map((cat) => {
                          const itemsInCat = weeklyNews.filter(item => item.category === cat);
                          if (itemsInCat.length === 0) return null;
                          return (
                            <div key={cat} className="space-y-6">
                              <h4 className="text-xl font-bold text-navy-dark border-b border-slate-100 pb-1 font-serif">
                                {cat}
                              </h4>
                              
                              <div className="space-y-8 divide-y divide-slate-100">
                                {itemsInCat.map((item) => {
                                  const isDayExcluded = excludedWeekdays.includes(item.weekday || 'Saturday');
                                  const isItemExcluded = item.excluded || isDayExcluded;
                                  return (
                                    <div key={item.id} className={cn("pt-6 first:pt-0 space-y-3.5 transition-all", isItemExcluded && "opacity-55")}>
                                      {/* Headline (Editable input style) */}
                                      <div className="flex gap-2 items-start justify-between">
                                        <div className="flex-1">
                                          {isDayExcluded && (
                                            <div className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200/50 rounded px-2 py-1 mb-2 inline-flex items-center gap-1 font-sans font-bold">
                                              ⚠️ This article's day ({item.weekday}) is excluded from compilation
                                            </div>
                                          )}
                                          {item.excluded && !isDayExcluded && (
                                            <div className="text-[10px] bg-rose-50 text-rose-600 border border-rose-100 rounded px-2 py-1 mb-2 inline-flex items-center gap-1 font-sans font-bold">
                                              🛑 This individual article is excluded from compilation
                                            </div>
                                          )}
                                          <textarea
                                            value={item.news}
                                            onChange={(e) => handleUpdateWeeklyItem(item.id, { news: e.target.value })}
                                            rows={1}
                                            className="text-base font-bold text-slate-800 bg-transparent hover:bg-slate-100 focus:bg-slate-100 transition-colors p-1 rounded border border-transparent hover:border-slate-300 focus:border-brand-primary outline-none font-serif w-full resize-none leading-snug"
                                            placeholder="Edit article title/headline..."
                                          />
                                        </div>
                                      
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDeleteWeeklyItem(item.id)}
                                        className="h-8 w-8 p-0 text-slate-300 hover:text-red-500 rounded-full transition-all shrink-0 mt-1"
                                        title="Delete article"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </Button>
                                    </div>

                                    {/* Narrative field (Large editable textarea) */}
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-slate-400 font-sans font-bold uppercase tracking-wider block">Narrative Description Body:</span>
                                      <textarea
                                        value={item.fullText || ''}
                                        onChange={(e) => handleUpdateWeeklyItem(item.id, { fullText: e.target.value })}
                                        rows={Math.max(3, Math.ceil((item.fullText || '').length / 90))}
                                        className="text-xs md:text-sm text-slate-600 bg-transparent hover:bg-slate-100 focus:bg-slate-100 transition-colors p-2 rounded border border-transparent hover:border-slate-300 focus:border-brand-primary outline-none font-serif w-full resize-none leading-relaxed text-justify"
                                        placeholder="Add news detail description story narrative... Our prompt extracts this from the source file."
                                      />
                                    </div>

                                    {/* Source link (Editable input) */}
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center pt-2">
                                      <div className="md:col-span-2 flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                                        <span className="text-[9.5px] font-sans font-bold text-slate-400 uppercase tracking-wider">Source link:</span>
                                        <input
                                          type="text"
                                          value={item.sourceLink || ''}
                                          onChange={(e) => handleUpdateWeeklyItem(item.id, { sourceLink: e.target.value })}
                                          className="text-xs text-blue-600 bg-transparent border-none outline-none font-sans flex-1"
                                          placeholder="No source link extracted..."
                                        />
                                      </div>

                                      {/* Side/EV toggles */}
                                      <div className="flex flex-wrap items-center gap-1.5 md:justify-end md:col-span-2 font-sans text-xs">
                                        <button
                                          onClick={() => handleUpdateWeeklyItem(item.id, { isEV: !item.isEV })}
                                          className={cn(
                                            "px-2.5 py-1 rounded-lg font-bold border flex items-center gap-1 cursor-pointer transition-colors",
                                            item.isEV 
                                              ? "bg-emerald-50 text-emerald-800 border-emerald-300" 
                                              : "bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-600"
                                          )}
                                        >
                                          ⚡ EV Indicator {item.isEV ? "Active" : "Off"}
                                        </button>
                                        
                                        <select
                                          value={item.side || 'l'}
                                          onChange={(e) => handleUpdateWeeklyItem(item.id, { side: e.target.value as 'l' | 'r' })}
                                          className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 cursor-pointer outline-none transition-colors animate-fade-in"
                                        >
                                          <option value="l">Left (L)</option>
                                          <option value="r">Right (R)</option>
                                        </select>

                                        <select
                                          value={item.weekday || 'Saturday'}
                                          onChange={(e) => handleUpdateWeeklyItem(item.id, { weekday: e.target.value })}
                                          className="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 cursor-pointer outline-none transition-colors"
                                        >
                                          <option value="Saturday">Saturday</option>
                                          <option value="Sunday">Sunday</option>
                                          <option value="Monday">Monday</option>
                                          <option value="Tuesday">Tuesday</option>
                                          <option value="Wednesday">Wednesday</option>
                                          <option value="Thursday">Thursday</option>
                                          <option value="Friday">Friday</option>
                                        </select>
                                      </div>
                                    </div>

                                    {/* Curator notes / Peer change suggestions for this article */}
                                    <div className="pt-1 select-none font-sans">
                                      <div className="flex items-center gap-1 px-1 mb-1">
                                        <MessageSquare className="w-3 h-3 text-amber-500 animate-pulse-subtle" />
                                        <span className="text-[10px] text-amber-800 uppercase font-bold tracking-wider">Curator Draft Comments & Peer Change Notes</span>
                                      </div>
                                      <input
                                        type="text"
                                        value={item.remark || ''}
                                        onChange={(e) => handleUpdateWeeklyItem(item.id, { remark: e.target.value })}
                                        className="w-full text-xs text-amber-800 font-medium bg-amber-50/40 hover:bg-amber-50/75 focus:bg-amber-100/50 hover:border-amber-400 focus:border-amber-500 rounded-lg py-1.5 px-3 border border-amber-200/50 outline-none transition-all shadow-inner-sm"
                                        placeholder="Click to type draft progress status, translation checks, specific corrections, or suggested edits..."
                                      />
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Weekly Tracker Workflow Sidebar Tools (Right Panel) */}
              <div className="space-y-6 text-left">
                {/* Active Curation Batch Import Panel */}
                <Card className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse-subtle" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">Add News to Board</h4>
                      <p className="text-[11px] text-slate-500 font-medium font-sans">Ingest raw files or active batches</p>
                    </div>
                  </div>
                  
                  {/* Select target date & day options - ALWAYS KEPT VISIBLE */}
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1 text-left">
                        <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          Target Date
                        </label>
                        <input
                          type="date"
                          value={importDate}
                          onChange={(e) => handleUpdateImportDate(e.target.value)}
                          className="w-full text-xs font-semibold text-navy-dark bg-[#F8FAFC] border border-slate-200 hover:border-slate-300 focus:border-brand-primary outline-none p-2 rounded-lg transition-colors cursor-pointer font-sans"
                        />
                      </div>
                      
                      <div className="space-y-1 text-left">
                        <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Target Weekday
                        </label>
                        <select
                          value={importWeekday}
                          onChange={(e) => setImportWeekday(e.target.value)}
                          className="w-full text-xs font-semibold text-slate-700 bg-[#F8FAFC] border border-slate-200 hover:border-slate-300 outline-none p-2 rounded-lg cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors"
                        >
                          <option value="Saturday">Saturday</option>
                          <option value="Sunday">Sunday</option>
                          <option value="Monday">Monday</option>
                          <option value="Tuesday">Tuesday</option>
                          <option value="Wednesday">Wednesday</option>
                          <option value="Thursday">Thursday</option>
                          <option value="Friday">Friday</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {result && result.items.length > 0 ? (
                    <div className="bg-emerald-50/55 border border-emerald-250 p-3 rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-emerald-800">
                          Active Curation Queue:
                        </span>
                        <Badge variant="secondary" className="bg-emerald-100/85 text-emerald-800 border-none px-2 py-0.5 text-[10px] font-bold">
                          {result.items.length} items
                        </Badge>
                      </div>
                      <p className="text-[10.5px] text-slate-600 leading-normal font-sans">
                        Press below to import the current curated batch from Active Curation into your Board on <strong>{importDate} ({importWeekday})</strong>.
                      </p>
                      
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleAddToWeeklyCollation(importDate, importWeekday)}
                          className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow cursor-pointer transition-all"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Import Batch
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setResult(null);
                            toast.info("Active curation queue cleared.");
                          }}
                          className="h-9 font-semibold text-xs border-slate-200 hover:bg-slate-50 shrink-0 cursor-pointer"
                          title="Clear active queue"
                        >
                          ✖ Clear
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <p className="text-[10.5px] text-[#64748B] leading-relaxed font-semibold font-sans">
                        Direct Ingestion: Select a raw automotive source file to scan & append curated narratives directly to this day!
                      </p>
                      
                      {parsingFile ? (
                        <div className="h-[100px] border border-dashed border-slate-200 rounded-xl bg-slate-50 flex flex-col items-center justify-center text-slate-400 text-[10px]">
                          <Loader2 className="w-5 h-5 animate-spin text-brand-primary mb-1.5" />
                          <span className="font-semibold text-slate-500 font-sans">Extracting content structure...</span>
                        </div>
                      ) : (
                        <label className="border border-dashed border-slate-200 hover:border-slate-200 rounded-xl bg-slate-50 hover:bg-slate-100/10 p-4 transition-all flex flex-col items-center justify-center cursor-pointer">
                          <input 
                            type="file" 
                            accept=".zip,.pdf,.docx,.xlsx,.xls,.txt,.html,image/*"
                            className="hidden" 
                            onChange={async (e) => {
                              const fileSelected = e.target.files?.[0];
                              if (fileSelected) {
                                setFile(fileSelected);
                                setParsingFile(true);
                                try {
                                  const isImage = fileSelected.type.startsWith('image/');
                                  const isZip = fileSelected.name.toLowerCase().endsWith('.zip');
                                  
                                  if (isZip) {
                                    setImageInlineData(null);
                                    toast.info(`Extracting ZIP folder: ${fileSelected.name}...`);
                                    const zip = await JSZip.loadAsync(fileSelected as any);
                                    let combinedText = '';
                                    const zipPromises: Promise<void>[] = [];
                                    
                                    zip.forEach((relativePath, zipEntry) => {
                                      if (zipEntry.dir || relativePath.startsWith('__MACOSX') || relativePath.split('/').pop()?.startsWith('.')) {
                                        return;
                                      }
                                      const promise = zipEntry.async('uint8array').then(async (content) => {
                                        const extractedFile = new File([content], zipEntry.name);
                                        try {
                                          const text = await parseFile(extractedFile);
                                          combinedText += `=== EXTRACTED FILE: ${zipEntry.name} ===\n\n${text}\n\n`;
                                        } catch (err: any) {
                                          console.error(`Error parsing extracted file ${zipEntry.name}:`, err);
                                        }
                                      });
                                      zipPromises.push(promise);
                                    });
                                    
                                    await Promise.all(zipPromises);
                                    setRawUploadedText(combinedText);
                                    toast.success(`Loaded and unpacked ZIP: extracted ${zipPromises.length} files!`);
                                  } else if (!isImage) {
                                    setImageInlineData(null);
                                    const rawText = await parseFile(fileSelected);
                                    setRawUploadedText(rawText);
                                    toast.success(`Loaded and parsed: ${fileSelected.name}`);
                                  } else {
                                    const base64 = await convertImageToBase64(fileSelected);
                                    setImageInlineData({
                                      data: base64,
                                      mimeType: fileSelected.type
                                    });
                                    setRawUploadedText('Image loaded for curation scan.');
                                    toast.success(`Loaded image: ${fileSelected.name}`);
                                  }
                                } catch (err: any) {
                                  console.error(err);
                                  toast.error("Failed to parse file: " + err.message);
                                } finally {
                                  setParsingFile(false);
                                }
                              }
                            }}
                          />
                          <div className="text-2xl mb-1">📄</div>
                          <span className="text-xs font-bold text-slate-700 truncate max-w-[200px]">
                            {file ? file.name : "Select raw file..."}
                          </span>
                          <span className="text-[10px] text-slate-400">ZIP, PDF, DOCX, XLSX, TXT, images</span>
                        </label>
                      )}

                      {file && !parsingFile && (
                        <div className="flex items-center justify-between text-xs bg-slate-100 p-2 rounded border border-slate-200 animate-fade-in">
                          <span className="truncate font-semibold text-slate-700 select-all max-w-[150px]">{file.name}</span>
                          <button 
                            type="button" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setFile(null);
                              setImageInlineData(null);
                              setRawUploadedText('');
                            }}
                            className="text-red-500 font-bold hover:text-red-700 p-1 cursor-pointer font-sans"
                          >
                            ✖ Clear
                          </button>
                        </div>
                      )}

                      <Button
                        onClick={async () => {
                          if (!file) {
                            toast.error("Please select a file to ingest first.");
                            return;
                          }
                          setProcessing(true);
                          setProgress(10);
                          try {
                            setProgress(25);
                            let rawText = rawUploadedText || "";
                            let inlineData = imageInlineData || undefined;
                            const isImage = file.type.startsWith('image/');

                            if (isImage) {
                              if (!inlineData) {
                                const base64 = await convertImageToBase64(file);
                                inlineData = {
                                  data: base64,
                                  mimeType: file.type
                                };
                                setImageInlineData(inlineData);
                              }
                            } else {
                              if (!rawText.trim()) {
                                toast.info(`Extracting contents from ${file.name}...`);
                                rawText = await parseFile(file);
                                setRawUploadedText(rawText);
                              }
                            }

                            setProgress(50);
                            toast.info("Performing automotive curation scanning...");
                            const existingTitles = weeklyNews.map(item => item.news || item.headline || "");
                            const curateResult = await curateNews(rawText, file.name, inlineData, existingTitles);

                            if (!curateResult || !curateResult.items || curateResult.items.length === 0) {
                              toast.info("No news headlines were discovered in this source.");
                              return;
                            }

                            // Assign stable unique IDs
                            curateResult.items = curateResult.items.map((item, idx) => ({
                              ...item,
                              id: item.id || `curated_${idx}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
                            }));

                            setProgress(70);
                            toast.info("Extracting detailed narratives and links...");
                            const compiledItems = await extractDetailedNews(curateResult.items, rawText);

                            setProgress(90);
                            const itemsWithWeekdays = compiledItems.map(item => {
                              const original = curateResult.items?.find((o: any) => o.id === item.id);
                              return {
                                id: item.id || Math.random().toString(36).substring(2, 9),
                                date: importDate,
                                weekday: importWeekday,
                                category: item.category,
                                news: applyStrictSOPCleaning(item.news),
                                fullText: applyStrictSOPCleaning(item.fullText || item.news),
                                sourceLink: item.sourceLink || original?.sourceLink || '',
                                isEV: item.isEV || item.news.toLowerCase().includes("electric") || item.news.toLowerCase().includes("ev ") || item.category === "Electrification",
                                side: item.side || original?.side || 'l',
                                remark: applyStrictSOPCleaning(original?.remark || '')
                              };
                            });

                            saveWeeklyNews(prev => {
                              const merged = [...prev];
                              let addedCount = 0;
                              let dupCount = 0;
                              itemsWithWeekdays.forEach(newItem => {
                                const exists = merged.some(existing => existing.news.trim().toLowerCase() === newItem.news.trim().toLowerCase());
                                if (!exists) {
                                  merged.push(newItem);
                                  addedCount++;
                                } else {
                                  dupCount++;
                                }
                              });
                              toast.success(`Successfully scanned ${file.name}! Added ${addedCount} curated stories under ${importWeekday} (${dupCount} duplicate(s) ignored).`);
                              return merged;
                            });

                            setResult(null);

                          } catch (err: any) {
                            console.error(err);
                            toast.error("Ingestion failed: " + err.message);
                          } finally {
                            setProcessing(false);
                            setProgress(0);
                          }
                        }}
                        disabled={!file || processing || parsingFile}
                        className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow cursor-pointer transition-all flex items-center justify-center"
                      >
                        {processing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            <span>Processing {Math.round(progress)}% ...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 animate-pulse-subtle text-white" />
                            <span>Scan & Ingest to Draft</span>
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </Card>



                {/* 1. Final Friday Core Compilation Action Card */}
                <Card className="rounded-xl border-border-slate shadow-md bg-navy-dark text-white p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10 font-bold select-none text-7xl font-sans">W</div>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold uppercase tracking-widest text-[#10B981]">Production Export</h4>
                      <p className="text-2xl font-black tracking-tight leading-none text-white">Compile & Export</p>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-normal">
                      Friday is Newsletter Day! Gather, edit, and review all Saturday-to-Friday shortlisted articles, and export the unified SOP-compliant index and narrative Document with a single click.
                    </p>
                    <div className="bg-[#1E293B]/60 rounded-lg p-3 border border-slate-700/50 space-y-1 text-xs">
                      <div className="flex justify-between font-semibold">
                        <span className="text-slate-400">Draft Status:</span>
                        <span className={weeklyNews.length > 0 ? "text-emerald-400" : "text-amber-400"}>
                          {weeklyNews.length > 0 ? "Active Draft" : "Empty Board"}
                        </span>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-slate-400">Estimated Segment Count:</span>
                        <span className="text-slate-200">{weeklyNews.length} news items</span>
                      </div>
                    </div>
                    <Button 
                      onClick={handleDownloadWeeklyWord}
                      disabled={weeklyNews.length === 0}
                      className="w-full h-11 bg-brand-primary hover:bg-brand-primary/90 text-white font-bold tracking-wide shadow-lg cursor-pointer flex items-center justify-center gap-2 animate-pulse-subtle"
                      title="Compile and download all weekly shortlisted news items"
                    >
                      <Download className="w-4 h-4" />
                      Compile Word (.docx)
                    </Button>
                    <Button 
                      onClick={handleDownloadWeeklyExcel}
                      disabled={weeklyNews.length === 0}
                      className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold tracking-wide shadow-lg cursor-pointer flex items-center justify-center gap-2 mt-2"
                      title="Compile Excel spreadsheet"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Compile Excel (.xlsx)
                    </Button>
                    {weeklyNews.length > 0 && (
                      <Button 
                        onClick={handleClearWeeklyCollation}
                        className="w-full h-10 bg-transparent hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 font-bold text-xs tracking-wide border border-rose-500/20 hover:border-rose-500/50 cursor-pointer flex items-center justify-center gap-2 mt-2 transition-all rounded-lg"
                        title="Completely clear all compiled weekly draft articles"
                      >
                        <Trash2 className="w-4 h-4" />
                        Reset / Clear Draft Board
                      </Button>
                    )}
                  </div>
                </Card>

                {/* 2. Visual Weekday Completion Status Tracker Checklist */}
                <Card className="rounded-xl border-border-slate shadow-sm">
                  <CardHeader className="bg-[#FAFBFC] border-b border-[#CBD5E1]/20 py-4 px-5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
                      Saturday to Friday Tracker
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 space-y-2.5">
                    {(() => {
                      const weekdaysOrder = ["Saturday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
                      return weekdaysOrder.map(day => {
                        const count = weeklyNews.filter(item => item.weekday === day).length;
                        const isDayExcluded = excludedWeekdays.includes(day);
                        return (
                          <div key={day} className={cn(
                            "flex items-center justify-between text-xs py-1.5 px-2 bg-slate-50/50 rounded-lg hover:bg-slate-50 transition-all border",
                            isDayExcluded ? "border-amber-100 bg-amber-50/10 opacity-75" : "border-transparent"
                          )}>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {/* Day exclusion checkbox control */}
                              <input
                                type="checkbox"
                                checked={!isDayExcluded}
                                onChange={() => handleToggleDayWordExclusion(day)}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                                title={isDayExcluded ? `Include ${day} in Word compilation` : `Exclude ${day} from Word compilation`}
                              />
                              
                              <span 
                                className={cn(
                                  "font-semibold text-slate-700 truncate cursor-pointer select-none", 
                                  count > 0 && "text-slate-900 font-bold",
                                  isDayExcluded && "line-through text-slate-400 font-normal"
                                )}
                                onClick={() => handleToggleDayWordExclusion(day)}
                                title="Click to toggle compiling inclusion for this day"
                              >
                                {day}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn(
                                "text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full text-center min-w-[50px] inline-block",
                                count > 0 
                                  ? (isDayExcluded ? "bg-amber-50 text-amber-700 border border-amber-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100") 
                                  : "bg-slate-100 text-slate-400"
                              )}>
                                {count > 0 ? (isDayExcluded ? "excluded" : `${count} news`) : "nil"}
                              </span>

                              {count > 0 && (
                                <button
                                  onClick={() => handleClearDayNews(day)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer"
                                  title={`Permanently delete all loaded news items of ${day} from the board`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </CardContent>
                </Card>

                {/* 3. Overall Curation Progress Feedback Notebook */}
                <Card className="rounded-xl border-border-slate shadow-sm">
                  <CardHeader className="bg-[#FAFBFC] border-b border-[#CBD5E1]/20 py-4 px-5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-2">
                      <Notebook className="w-4 h-4 text-amber-500" />
                      Peer Feedback & Progress Notebook
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 px-5 pb-5">
                    <p className="text-[11px] text-[#64748B] mb-2 leading-normal">
                      Note down active modifications, checklist reminders, supervisor corrections, or overall Friday compile notes:
                    </p>
                    <textarea
                      value={progressNotes}
                      onChange={(e) => saveProgressNotes(e.target.value)}
                      placeholder="e.g., waiting on Tuesday EV ancillary reports, edit Monday's corporate layout to right side, checked SOP replacements..."
                      rows={6}
                      className="w-full text-xs font-semibold text-navy-dark leading-relaxed p-3 border border-slate-200 focus:border-brand-primary rounded-xl resize-none outline-none bg-slate-50/50 hover:bg-white focus:bg-white transition-all shadow-inner-sm"
                    />
                  </CardContent>
                </Card>

                {/* 4. Quick Manual Daily News Inline Form */}
                <Card className="rounded-xl border-border-slate shadow-sm">
                  <CardHeader className="bg-[#FAFBFC] border-b border-[#CBD5E1]/20 py-4 px-5">
                    <CardTitle className="text-xs font-bold uppercase tracking-wider text-[#64748B] flex items-center gap-1.5 flex-row">
                      <Plus className="w-4 h-4 text-brand-primary" />
                      Add Manual News Story
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 space-y-4 text-left">
                    {/* Day / Category SELECTOR */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">Weekday</label>
                        <select
                          value={manualWeekday}
                          onChange={(e) => setManualWeekday(e.target.value)}
                          className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors shadow-xs"
                        >
                          <option value="Saturday">Saturday</option>
                          <option value="Sunday">Sunday</option>
                          <option value="Monday">Monday</option>
                          <option value="Tuesday">Tuesday</option>
                          <option value="Wednesday">Wednesday</option>
                          <option value="Thursday">Thursday</option>
                          <option value="Friday">Friday</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">SOP Category</label>
                        <select
                          value={manualCategory}
                          onChange={(e) => setManualCategory(e.target.value)}
                          className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors shadow-xs"
                        >
                          {categoriesSOP.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Side / Option Selector */}
                    <div className="grid grid-cols-2 gap-2.5 text-left">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">Layout Side</label>
                        <select
                          value={manualSide}
                          onChange={(e) => setManualSide(e.target.value as 'l' | 'r')}
                          className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-2 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors shadow-xs"
                        >
                          <option value="l">Left (L)</option>
                          <option value="r">Right (R)</option>
                        </select>
                      </div>

                      <div className="space-y-1 flex flex-col justify-end pb-1.5 pl-1.5 min-h-[44px]">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={manualIsEV}
                            onChange={(e) => setManualIsEV(e.target.checked)}
                            className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-300"
                          />
                          ⚡ EV Flag
                        </label>
                      </div>
                    </div>

                    {/* Headline and Narrative */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">News Headline</label>
                      <input
                        type="text"
                        value={manualNews}
                        onChange={(e) => setManualNews(e.target.value)}
                        placeholder="e.g. Tata Motors announces battery plant"
                        className="w-full text-xs text-navy-dark p-2 border border-slate-200 rounded-lg focus:border-brand-primary outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">Narrative Content description</label>
                      <textarea
                        value={manualFullText}
                        onChange={(e) => setManualFullText(e.target.value)}
                        placeholder="Add paragraph narrative detail..."
                        rows={3}
                        className="w-full text-xs text-navy-dark p-2 border border-slate-200 rounded-lg resize-none focus:border-brand-primary outline-none transition-colors font-sans"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wide">Source URL link</label>
                      <input
                        type="text"
                        value={manualSourceLink}
                        onChange={(e) => setManualSourceLink(e.target.value)}
                        placeholder="e.g. https://auto.economictimes.indiatimes.com/..."
                        className="w-full text-xs text-navy-dark p-2 border border-slate-200 rounded-lg focus:border-brand-primary outline-none transition-colors font-sans"
                      />
                    </div>

                    <Button
                      onClick={() => handleAddManualItem()}
                      className="w-full h-10 bg-brand-primary hover:bg-brand-primary/90 text-white font-bold text-xs gap-1 opacity-90 shadow cursor-pointer mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Insert into Weekly Draft
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          )}
        </main>
      </div>
      {/* Active Curation Batch Import Modal */}
      <AnimatePresence>
        {showImportDialog && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden text-left"
            >
              <div className="bg-[#1E293B] text-white p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Calendar className="w-5 h-5 animate-pulse-subtle" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold">Import Curation Batch</h3>
                    <p className="text-xs text-slate-300 font-medium">Batch of {result?.items.length || 0} curated news headlines</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-[#64748B] leading-relaxed font-sans">
                  The Weekly Draft Board groups news narratives by individual days. Select the target Date and Weekday to organize these news items under that category in the exported Word file.
                </p>

                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Target Date</label>
                    <input
                      type="date"
                      value={importDate}
                      onChange={(e) => handleUpdateImportDate(e.target.value)}
                      className="w-full text-xs text-navy-dark bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 focus:border-brand-primary outline-none transition-colors cursor-pointer font-sans"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Target Weekday</label>
                    <select
                      value={importWeekday}
                      onChange={(e) => setImportWeekday(e.target.value)}
                      className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors focus:bg-white"
                    >
                      <option value="Saturday">Saturday</option>
                      <option value="Sunday">Sunday</option>
                      <option value="Monday">Monday</option>
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setShowImportDialog(false)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleAddToWeeklyCollation(importDate, importWeekday)}
                    className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow"
                  >
                    <Check className="w-4 h-4" />
                    Start Adding Data
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showAddStoryModal && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden text-left my-8"
            >
              <div className="bg-[#1E293B] text-white p-5 flex items-center justify-between border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Add Custom News Story</h3>
                    <p className="text-xs text-slate-300 font-medium">Inject a story directly into the compilation draft</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowAddStoryModal(false)}
                  className="text-slate-400 hover:text-white transition-colors p-1"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Select Weekday */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Target Weekday</label>
                    <select
                      value={modalWeekday}
                      onChange={(e) => setModalWeekday(e.target.value)}
                      className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors focus:bg-white"
                    >
                      <option value="Saturday">Saturday</option>
                      <option value="Sunday">Sunday</option>
                      <option value="Monday">Monday</option>
                      <option value="Tuesday">Tuesday</option>
                      <option value="Wednesday">Wednesday</option>
                      <option value="Thursday">Thursday</option>
                      <option value="Friday">Friday</option>
                    </select>
                  </div>

                  {/* Layout Column Side orientation */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Layout Side Column</label>
                    <select
                      value={modalLayoutSide}
                      onChange={(e) => setModalLayoutSide(e.target.value as 'l' | 'r')}
                      className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors focus:bg-white"
                    >
                      <option value="l">Left Side Column (Standard)</option>
                      <option value="r">Right Side Column</option>
                    </select>
                  </div>
                </div>

                {/* News Category SOP */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Automotive Section Category</label>
                  <select
                    value={modalCategory}
                    onChange={(e) => setModalCategory(e.target.value)}
                    className="w-full text-xs text-[#1E293B] bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 outline-none cursor-pointer focus:ring-1 focus:ring-brand-primary transition-colors focus:bg-white"
                  >
                    {categoriesSOP.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {/* Headline / Title */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Headline / Headline Title (Required)</label>
                  <input
                    type="text"
                    required
                    value={modalHeadline}
                    onChange={(e) => setModalHeadline(e.target.value)}
                    placeholder="Enter short, rich headline..."
                    className="w-full text-xs text-navy-dark bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 focus:border-brand-primary outline-none transition-colors font-sans"
                  />
                </div>

                {/* Source link */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Source Link (Optional)</label>
                  <input
                    type="url"
                    value={modalSourceLink}
                    onChange={(e) => setModalSourceLink(e.target.value)}
                    placeholder="e.g. https://auto.economictimes.indiatimes.com/news/..."
                    className="w-full text-xs text-navy-dark bg-slate-50 border border-slate-200 rounded-lg p-2.5 hover:border-slate-300 focus:border-brand-primary outline-none transition-colors font-sans"
                  />
                </div>

                {/* EV relation Checkbox */}
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="modalIsEV"
                    checked={modalIsEV}
                    onChange={(e) => setModalIsEV(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-primary focus:ring-brand-primary cursor-pointer"
                  />
                  <label htmlFor="modalIsEV" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                    ⚡ This is an Electric Vehicle (EV) related story
                  </label>
                </div>

                {/* Full narrative Paragraph(s) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Detailed Narrative (Preserves Paragraphs)</label>
                    <span className="text-[10px] font-mono text-slate-400">Press Enter for multi-paragraphs</span>
                  </div>
                  <textarea
                    value={modalFullText}
                    onChange={(e) => setModalFullText(e.target.value)}
                    placeholder="Paste or type the exact background narrative paragraphs below the news story here. Formatting and multiple paragraphs are supported and will be preserved exactly as written in Word & Text compilation."
                    className="w-full h-32 p-3 text-xs text-navy-dark bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 focus:border-brand-primary outline-none transition-colors resize-y leading-relaxed font-sans"
                  />
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setShowAddStoryModal(false)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddCustomStoryFromModal}
                    className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5 shadow cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    Add Story
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showResetConfirm && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden text-left"
            >
              <div className="bg-rose-950 text-white p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5 animate-pulse-subtle" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Reset Weekly Draft & Week</h3>
                    <p className="text-xs text-rose-200 font-medium font-sans">Critical consolidation action</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm font-semibold text-navy-dark leading-relaxed font-sans">
                  Are you sure you want to clear your entire weekly draft?
                </p>
                <p className="text-xs text-[#64748B] leading-relaxed font-sans">
                  This action will delete all items on your Weekly Board, clear progress summaries, and reset the Friday compilation date back to default. This cannot be undone.
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setShowResetConfirm(false)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    Keep Draft
                  </Button>
                  <Button
                    onClick={executeClearWeeklyCollation}
                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs gap-1.5 shadow cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, Reset Everything
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showCurationResetConfirm && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden text-left"
            >
              <div className="bg-rose-950 text-white p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Reset Active Curation</h3>
                    <p className="text-xs text-rose-200 font-medium font-sans">Discard current working batch</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm font-semibold text-navy-dark leading-relaxed font-sans">
                  Discard the current curation queue?
                </p>
                <p className="text-xs text-[#64748B] leading-relaxed font-sans">
                  This action will clear all current extracted segments, active edits, and file/text uploads. Any changes not shortlisted to the Weekly Board will be lost.
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setShowCurationResetConfirm(false)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    Keep Queue
                  </Button>
                  <Button
                    onClick={handleClearActiveCuration}
                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs gap-1.5 shadow cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Reset Queue
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {dayToClear && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden text-left"
            >
              <div className="bg-rose-950 text-white p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Clear {dayToClear} News</h3>
                    <p className="text-xs text-rose-200 font-medium font-sans">Delete compiled day items</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm font-semibold text-navy-dark leading-relaxed font-sans">
                  Are you sure you want to completely remove all compiled news items for <span className="text-rose-600 font-bold">{dayToClear}</span>?
                </p>
                <p className="text-xs text-[#64748B] leading-relaxed font-sans">
                  This action will clear all news stories associated with {dayToClear} from your board. This cannot be undone.
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setDayToClear(null)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={executeClearDayNews}
                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-1.5 shadow cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, Clear Day
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {itemToDelete && (
          <div className="fixed inset-0 bg-[#0F172A]/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden text-left"
            >
              <div className="bg-rose-950 text-white p-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Delete News Headline</h3>
                    <p className="text-xs text-rose-200 font-medium font-sans">Remove single item from board</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm font-semibold text-navy-dark leading-relaxed font-sans">
                  Are you sure you want to delete this news story?
                </p>
                <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs italic text-slate-700 leading-relaxed font-serif max-h-24 overflow-y-auto">
                  "{itemToDelete.headline}"
                </div>
                <p className="text-xs text-[#64748B] leading-relaxed font-sans">
                  This action will permanently delete this story from the weekly board, and it will be omitted from any compiled Word documents.
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <Button
                    onClick={() => setItemToDelete(null)}
                    variant="outline"
                    className="flex-1 h-10 border-slate-200 font-bold text-xs hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={executeDeleteWeeklyItem}
                    className="flex-1 h-10 bg-rose-600 hover:bg-rose-750 text-white font-bold text-xs gap-1.5 shadow cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Yes, Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <Toaster position="top-right" />
    </div>
  );
}


