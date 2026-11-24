import React, { useState } from 'react';
import { 
  Sparkles, SlidersHorizontal, RotateCcw, X, Check, AlertCircle, 
  UserX, FileX2, Award, ShieldCheck, ChevronRight, Info, CheckCircle2, 
  HelpCircle, Filter, FileText
} from 'lucide-react';
import { 
  PreprocessingConfig, 
  DEFAULT_PREPROCESSING_CONFIG, 
  PreprocessingResult 
} from '../autoPreprocessor';

export interface AutoPreprocessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: PreprocessingConfig;
  onChangeConfig: (updates: Partial<PreprocessingConfig>) => void;
  onResetConfig: () => void;
  onApply: (customConfig?: PreprocessingConfig) => void;
  lastResult: PreprocessingResult | null;
  totalSubjects: number;
  totalTrials: number;
}

export const AutoPreprocessingModal: React.FC<AutoPreprocessingModalProps> = ({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onResetConfig,
  onApply,
  lastResult,
  totalSubjects,
  totalTrials
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'results'>('rules');
  const [logFilter, setLogFilter] = useState<'all' | 'CALIBRATION' | 'SUBJECT' | 'TRIAL' | 'SOLVER'>('all');

  if (!isOpen) return null;

  const handleApply = () => {
    onApply();
    setActiveTab('results');
  };

  const filteredLog = (lastResult?.log || []).filter(item => {
    if (logFilter === 'all') return true;
    return item.type === logFilter;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-fade-in select-none">
      <div 
        className="w-full max-w-3xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/30">
              <Sparkles size={18} className="text-amber-300" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Автоматическая предобработка данных</span>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Ленивый режим (1 клик)
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Настройка критериев отсева артефактов, порогов браковки и правил выявления решений
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-2.5 pb-0 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1.5 rounded-t-xl text-xs font-bold flex items-center gap-1.5 transition-all border-b-2 ${
                activeTab === 'rules'
                  ? 'border-indigo-500 text-white bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <SlidersHorizontal size={13} className="text-indigo-400" />
              <span>Правила и пороги</span>
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-3 py-1.5 rounded-t-xl text-xs font-bold flex items-center gap-1.5 transition-all border-b-2 ${
                activeTab === 'results'
                  ? 'border-indigo-500 text-white bg-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText size={13} className="text-emerald-400" />
              <span>Результаты и статистика {lastResult && `(✓)`}</span>
            </button>
          </div>

          <div className="text-[10px] text-slate-400 pb-1">
            Загружено: <strong className="text-white">{totalSubjects}</strong> исп. / <strong className="text-white">{totalTrials}</strong> проб
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {activeTab === 'rules' && (
            <>
              {/* SECTION 1: SUBJECT-LEVEL EXCLUSION */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 font-bold text-slate-200">
                    <UserX size={15} className="text-rose-400" />
                    <span>1. Правила отсева невалидных испытуемых (Subject-Level)</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Критерии целостности выборки</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Min Trials */}
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-300">
                        Мин. количество попыток:
                      </label>
                      <span className="font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        {config.minTrialsSubject} проб
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={config.minTrialsSubject}
                      onChange={(e) => onChangeConfig({ minTrialsSubject: Number(e.target.value) })}
                      className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg mb-1"
                    />
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Исключать испытуемых с менее чем {config.minTrialsSubject} попытками (норма: 4)</span>
                    </div>
                  </div>

                  {/* Min Total Time */}
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-300">
                        Мин. время участия в задаче:
                      </label>
                      <span className="font-mono text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                        {config.minTotalTimeSeconds} сек
                      </span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="300"
                      step="10"
                      value={config.minTotalTimeSeconds}
                      onChange={(e) => onChangeConfig({ minTotalTimeSeconds: Number(e.target.value) })}
                      className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg mb-1"
                    />
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Исключать ранний уход (&lt; {config.minTotalTimeSeconds} с без решения)</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                  {/* Micro-click subjects */}
                  <label className="flex items-start gap-2 bg-slate-900/40 p-2 rounded-lg border border-slate-800/60 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.filterMicroClickSubjects}
                      onChange={(e) => onChangeConfig({ filterMicroClickSubjects: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Фильтр серии микро-кликов</span>
                      <p className="text-[10px] text-slate-400">
                        Исключать испытуемых с ≤ 5 проб, где ≥ 2 пробы длились менее 2 сек
                      </p>
                    </div>
                  </label>

                  {/* Corrupted subjects */}
                  <label className="flex items-start gap-2 bg-slate-900/40 p-2 rounded-lg border border-slate-800/60 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.excludeCorruptedSubjects}
                      onChange={(e) => onChangeConfig({ excludeCorruptedSubjects: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Исключать технические артефакты</span>
                      <p className="text-[10px] text-slate-400">
                        Автоматически отсекать повреждённые файлы («Рамка_13» и сбои трекинга)
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* SECTION 2: TRIAL-LEVEL EXCLUSION (5 RULES) */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 font-bold text-slate-200">
                    <FileX2 size={15} className="text-amber-400" />
                    <span>2. Правила отсева бракованных проб (Trial-Level: 5 правил)</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Авто-отсев невалидных попыток</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Rule 1: Zero dots hit */}
                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.excludeZeroDotsTrials}
                      onChange={(e) => onChangeConfig({ excludeZeroDotsTrials: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Правило 1: 0 задетых точек</span>
                      <p className="text-[10px] text-slate-400">
                        Исключать черкания мимо стимульного поля без касания ни одной из 9 точек
                      </p>
                    </div>
                  </label>

                  {/* Rule 4: Outside start minimal */}
                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.excludeOutsideStartMinimal}
                      onChange={(e) => onChangeConfig({ excludeOutsideStartMinimal: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Правило 4: Внешний старт</span>
                      <p className="text-[10px] text-slate-400">
                        Исключать старт снаружи рамки при задевании ≤ 1 точки
                      </p>
                    </div>
                  </label>

                  {/* Rule 5: Accidental micro-click */}
                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.excludeAccidentalMicroClicks}
                      onChange={(e) => onChangeConfig({ excludeAccidentalMicroClicks: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Правило 5: Случайный микро-клик</span>
                      <p className="text-[10px] text-slate-400">
                        Исключать случайные нажатия длительностью &lt; 0.5 с с ≤ 1 задетой точкой
                      </p>
                    </div>
                  </label>

                  {/* Rule 3: Off-screen move threshold */}
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-300">
                        Правило 3: Улёт за экран:
                      </label>
                      <span className="font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        {config.farDistThresholdPx} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="150"
                      max="600"
                      step="25"
                      value={config.farDistThresholdPx}
                      onChange={(e) => onChangeConfig({ farDistThresholdPx: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg mb-1"
                    />
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Порог ухода конечной точки за пределы рамки (по умолчанию: 350 px)</span>
                    </div>
                  </div>
                </div>

                {/* Rule 2: Chaotic lines & path length */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-300">
                        Правило 2: Максимум линий в пробе:
                      </label>
                      <span className="font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        &gt; {config.maxSegmentsPerTrial} линий
                      </span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="14"
                      step="1"
                      value={config.maxSegmentsPerTrial}
                      onChange={(e) => onChangeConfig({ maxSegmentsPerTrial: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg mb-1"
                    />
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Отсекать хаотичные попытки с чрезмерным числом отрезков</span>
                    </div>
                  </div>

                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-slate-300">
                        Правило 2: Макс. длина траектории:
                      </label>
                      <span className="font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        {config.maxPathLengthPx} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1500"
                      max="6000"
                      step="250"
                      value={config.maxPathLengthPx}
                      onChange={(e) => onChangeConfig({ maxPathLengthPx: Number(e.target.value) })}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg mb-1"
                    />
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Отсекать многократные закрашивания и запутанные спагетти</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: SOLVER DETECTION & APEX TURNING ZONE */}
              <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 font-bold text-slate-200">
                    <Award size={15} className="text-emerald-400" />
                    <span>3. Выявление решений и автокоррекция апекса</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Автоматический трофей 🏆 и зона вылета</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.detectSolutions}
                      onChange={(e) => onChangeConfig({ detectSolutions: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Выявлять решения</span>
                      <p className="text-[10px] text-slate-400">
                        Проверять классические 4 линии через 9 точек на финальной попытке
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.useKnownSolversList}
                      onChange={(e) => onChangeConfig({ useKnownSolversList: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Сверка с выборкой Савиновой</span>
                      <p className="text-[10px] text-slate-400">
                        Синхронизировать с верифицированным золотым стандартом (22 решателя)
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.autoAlignApexForSolvers}
                      onChange={(e) => onChangeConfig({ autoAlignApexForSolvers: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-slate-200">Автокоррекция апекса</span>
                      <p className="text-[10px] text-slate-400">
                        Автоматически центрировать зону поворота по финалу для всех решивших
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-amber-500/30 cursor-pointer hover:border-amber-500/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.autoAlignTrajectoriesToDots}
                      onChange={(e) => onChangeConfig({ autoAlignTrajectoriesToDots: e.target.checked })}
                      className="mt-0.5 rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <span className="font-bold text-amber-300">Авто-подгонка к 9 точкам</span>
                      <p className="text-[10px] text-slate-400">
                        Жёсткий сдвиг траекторий по центрам посещённых точек (для смещённых записей)
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'results' && (
            <div className="space-y-4">
              {lastResult ? (
                <>
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Активных испытуемых:</div>
                      <div className="text-xl font-bold font-mono text-emerald-400">
                        {lastResult.stats.activeSubjects} <span className="text-xs text-slate-500 font-normal">/ {lastResult.stats.totalSubjects}</span>
                      </div>
                      <div className="text-[9px] text-rose-400 font-medium">
                        Отсеяно: {lastResult.stats.excludedSubjectsCount}
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Активных попыток:</div>
                      <div className="text-xl font-bold font-mono text-emerald-400">
                        {lastResult.stats.activeTrials} <span className="text-xs text-slate-500 font-normal">/ {lastResult.stats.totalTrials}</span>
                      </div>
                      <div className="text-[9px] text-rose-400 font-medium">
                        Исключено: {lastResult.stats.excludedTrialsCount}
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Решений выявлено:</div>
                      <div className="text-xl font-bold font-mono text-amber-400 flex items-center gap-1">
                        <span>{lastResult.stats.solvedCount}</span>
                        <Award size={16} className="text-amber-400" />
                      </div>
                      <div className="text-[9px] text-slate-400">
                        {((lastResult.stats.solvedCount / Math.max(1, lastResult.stats.activeSubjects)) * 100).toFixed(1)}% успешности
                      </div>
                    </div>

                    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                      <div className="text-[10px] text-slate-400">Апексов авто-выровнено:</div>
                      <div className="text-xl font-bold font-mono text-sky-400">
                        {lastResult.stats.apexAlignedCount}
                      </div>
                      <div className="text-[9px] text-slate-400">
                        Зоны обновлены · 9т. выровнено: <span className="text-amber-300 font-bold">{lastResult.stats.trajectoriesAlignedCount}</span>
                      </div>
                    </div>
                  </div>

                  {/* Rule Breakdown */}
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                    <h4 className="font-bold text-slate-300 text-[11px] mb-2 flex items-center gap-1.5">
                      <Filter size={13} className="text-indigo-400" />
                      <span>Детализация причин исключения:</span>
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">0 точек в пробе:</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.zeroDots}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Хаос (&gt; 8 линий / спагетти):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.chaoticOrExcessive}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Улёт за экран (&gt; 350 px):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.offScreen}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Микро-клики (&lt; 0.5 с):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.microClick}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Мало проб у испытуемого (&lt; 4):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.tooFewTrials}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Ранний дропаут (&lt; 90 с):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.earlyDropout}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Серия микро-кликов (&lt; 2 с):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.erraticMicroClicks}</div>
                      </div>
                      <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400">Внешний старт (≤ 1 точка):</span>
                        <div className="font-mono text-white font-bold">{lastResult.stats.ruleBreakdown.outsideMinimal}</div>
                      </div>
                    </div>
                  </div>

                  {/* Filterable Detailed Event Log */}
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-300 text-[11px] flex items-center gap-1.5">
                        <FileText size={13} className="text-emerald-400" />
                        <span>Журнал событий предобработки ({filteredLog.length}):</span>
                      </h4>
                      <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[9px]">
                        <button
                          onClick={() => setLogFilter('all')}
                          className={`px-2 py-0.5 rounded font-bold ${logFilter === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          Все
                        </button>
                        <button
                          onClick={() => setLogFilter('CALIBRATION')}
                          className={`px-2 py-0.5 rounded font-bold ${logFilter === 'CALIBRATION' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          9 точек
                        </button>
                        <button
                          onClick={() => setLogFilter('SUBJECT')}
                          className={`px-2 py-0.5 rounded font-bold ${logFilter === 'SUBJECT' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          Испытуемые
                        </button>
                        <button
                          onClick={() => setLogFilter('TRIAL')}
                          className={`px-2 py-0.5 rounded font-bold ${logFilter === 'TRIAL' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          Пробы
                        </button>
                        <button
                          onClick={() => setLogFilter('SOLVER')}
                          className={`px-2 py-0.5 rounded font-bold ${logFilter === 'SOLVER' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                          Решения
                        </button>
                      </div>
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1 font-mono text-[10px]">
                      {filteredLog.map((entry, idx) => (
                        <div
                          key={`log-${idx}`}
                          className={`p-1.5 rounded flex items-center justify-between border ${
                            entry.type === 'SOLVER'
                              ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                              : (entry.type === 'CALIBRATION'
                                ? 'bg-sky-950/20 border-sky-500/30 text-sky-300'
                                : (entry.type === 'SUBJECT'
                                  ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                                  : 'bg-slate-900/60 border-slate-800 text-slate-300'))
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold">
                              {entry.type === 'SOLVER' && '🏆'}
                              {entry.type === 'CALIBRATION' && '🎯 Калибр.:'}
                              {entry.type === 'SUBJECT' && '🚫 Исп:'}
                              {entry.type === 'TRIAL' && '⚠️ Проба:'}
                            </span>
                            <span className="font-bold text-white">{entry.subjectId}</span>
                            {entry.trialId !== undefined && (
                              <span className="text-slate-400">#{entry.trialId}</span>
                            )}
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-300">{entry.details}</span>
                          </div>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                            {entry.reason}
                          </span>
                        </div>
                      ))}
                      {filteredLog.length === 0 && (
                        <div className="text-center py-4 text-slate-500 italic">
                          Нет событий по выбранному фильтру
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-10 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                    <Sparkles size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-300">Предобработка ещё не запускалась</h4>
                    <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1">
                      Перейдите на вкладку «Правила и пороги» и нажмите «Применить предобработку», чтобы очистить данные.
                    </p>
                  </div>
                  <button
                    onClick={handleApply}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs inline-flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
                  >
                    <Sparkles size={14} className="text-amber-300" />
                    <span>Запустить предобработку сейчас</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
          <button
            onClick={onResetConfig}
            className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Восстановить исходные стандартные пороги предобработки"
          >
            <RotateCcw size={13} />
            <span>Сбросить к стандарту</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Закрыть
            </button>

            <button
              onClick={handleApply}
              className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Sparkles size={14} className="text-amber-300" />
              <span>⚡ Применить предобработку (1 клик)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
