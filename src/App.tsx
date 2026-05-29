import React, { useState, useEffect } from 'react';
import { BRANCHES, CATEGORIES } from './constants';
import { Claim, Salesperson, Branch } from './types';
import { 
  Building2, 
  User, 
  Mail, 
  Phone, 
  FileText, 
  FileCheck, 
  CheckCircle, 
  XCircle, 
  Search, 
  RefreshCw, 
  Sparkles, 
  Upload, 
  Lock, 
  LogOut,
  AlertCircle,
  Send,
  Check,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'raise' | 'admin'>('raise');
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(false);

  // --- Form State ---
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [selectedSalesperson, setSelectedSalesperson] = useState<Salesperson | 'custom'>('custom');
  
  // claimant info
  const [claimantName, setClaimantName] = useState('');
  const [claimantEmail, setClaimantEmail] = useState('');
  
  // claim info - now supporting multiple lines
  const [expenseLines, setExpenseLines] = useState<Array<{
    id: string;
    title: string;
    origin?: string;
    destination?: string;
    amount: string;
    category: string;
    claimDate: string;
    description: string;
    fileName?: string;
    fileBase64?: string;
    fileType?: string;
  }>>([
    {
      id: "line_1",
      title: '',
      origin: '',
      destination: '',
      amount: '',
      category: '',
      claimDate: new Date().toISOString().split('T')[0],
      description: '',
      fileName: '',
      fileBase64: '',
      fileType: ''
    }
  ]);

  // Handler to add a new line
  const handleAddLine = () => {
    setExpenseLines(prev => [
      ...prev,
      {
        id: Math.random().toString(),
        title: '',
        origin: '',
        destination: '',
        amount: '',
        category: '',
        claimDate: new Date().toISOString().split('T')[0],
        description: '',
        fileName: '',
        fileBase64: '',
        fileType: ''
      }
    ]);
  };

  // Handler to remove a line
  const handleRemoveLine = (id: string) => {
    if (expenseLines.length <= 1) return;
    setExpenseLines(prev => prev.filter(line => line.id !== id));
  };

  // Handler to update a field on a specific line
  const handleUpdateLine = (id: string, field: string, value: string) => {
    setExpenseLines(prev => prev.map(line => {
      if (line.id === id) {
        return { ...line, [field]: value };
      }
      return line;
    }));
  };
  
  // status notifications
  const [formStatus, setFormStatus] = useState<{ type: 'idle' | 'submitting' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });

  // --- Admin State ---
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminLoggedInEmail, setAdminLoggedInEmail] = useState('');
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [adminEmailError, setAdminEmailError] = useState('');
  
  // Admin selected action states
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [remarksState, setRemarksState] = useState('');
  const [actionStatus, setActionStatus] = useState<{ type: 'idle' | 'updating' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });
  
  // Custom confirmation for deletion to avoid iframe sandbox blocked prompts
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSidebarConfirm, setDeleteSidebarConfirm] = useState(false);

  // Admin filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Fetch claims from Node.js backend proxy
  const fetchClaims = async () => {
    setLoadingClaims(true);
    try {
      const response = await fetch('/api/claims');
      const data = await response.json();
      if (data.success) {
        // Sort claims by date descending
        const sortedClaims = (data.claims || []).sort((a: Claim, b: Claim) => 
          new Date(b.submitDate).getTime() - new Date(a.submitDate).getTime()
        );
        setClaims(sortedClaims);
      }
    } catch (err: any) {
      console.error("Failed to load claims:", err);
    } finally {
      setLoadingClaims(false);
    }
  };

  useEffect(() => {
    fetchClaims();
  }, []);

  // Set claimant when salesperson profile changes
  useEffect(() => {
    if (selectedSalesperson === 'custom') {
      setClaimantName('');
      setClaimantEmail('');
    } else {
      setClaimantName(selectedSalesperson.name);
      setClaimantEmail(selectedSalesperson.email);
    }
  }, [selectedSalesperson]);

  // Submit Claim
  const handleSubmitClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranch) {
      setFormStatus({ type: 'error', message: 'Please select a Target Office Branch.' });
      return;
    }
    if (!claimantName || !claimantEmail) {
      setFormStatus({ type: 'error', message: 'Please complete all required fields.' });
      return;
    }

    // Validate all expense lines
    for (let i = 0; i < expenseLines.length; i++) {
      const line = expenseLines[i];
      if (!line.category || line.category === '') {
        setFormStatus({ type: 'error', message: `Please select a Category for Item #${i + 1}.` });
        return;
      }
      if (line.category === 'Travel') {
        if (!line.origin || !line.destination || !line.amount || !line.claimDate) {
          setFormStatus({ type: 'error', message: `Please complete Origin (From) and Destination (To) fields for Item #${i + 1}.` });
          return;
        }
      } else {
        if (!line.title || !line.amount || !line.claimDate) {
          setFormStatus({ type: 'error', message: `Please complete all required fields for Item #${i + 1}.` });
          return;
        }
      }
    }

    setFormStatus({ type: 'submitting', message: `Filing ${expenseLines.length} claim logs to Google Sheets & Drive...` });

    try {
      const totalAmount = expenseLines.reduce((acc, line) => acc + (Number(line.amount) || 0), 0);

      const itemsPayload = expenseLines.map((line) => {
        const submissionTitle = line.category === 'Travel'
          ? `Travel from ${line.origin?.trim()} to ${line.destination?.trim()}`
          : line.title;
          
        return {
          category: line.category,
          itemDate: line.claimDate,
          fromLoc: line.category === 'Travel' ? line.origin : '',
          toLoc: line.category === 'Travel' ? line.destination : '',
          amount: String(line.amount),
          remark: line.category === 'Travel' ? submissionTitle : (line.description || submissionTitle),
          // Attach file base64 data directly from this row item
          fileData: line.fileBase64 || null,
          fileName: line.fileName || null,
          fileType: line.fileType || 'application/octet-stream'
        };
      });

      const response = await fetch('/api/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchName: selectedBranch.name,
          salespersonName: claimantName,
          salespersonEmail: claimantEmail,
          items: itemsPayload,
          grandTotal: String(totalAmount),
          branchHeadEmail: selectedBranch.headEmail
        })
      });

      const resData = await response.json();
      if (resData.success) {
        setFormStatus({ 
          type: 'success', 
          message: `Successfully registered expense claim! (ID: ${resData.submissionId})` 
        });
        
        // Reset inputs
        setExpenseLines([
          {
            id: "line_1",
            title: '',
            origin: '',
            destination: '',
            amount: '',
            category: '',
            claimDate: new Date().toISOString().split('T')[0],
            description: '',
            fileName: '',
            fileBase64: '',
            fileType: ''
          }
        ]);
        setSelectedSalesperson('custom');
        
        // Reload table logs
        fetchClaims();
      } else {
        throw new Error(resData.error || 'Server failed to process your expense claim');
      }
    } catch (err: any) {
      setFormStatus({ type: 'error', message: `Submission failed: ${err.message}` });
    }
  };

  // Admin Verification Login Action
  const handleAdminVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedInput = adminEmailInput.trim().toLowerCase();
    
    const AUTHORIZED_ADMINS = [
      'cash.udhna@ginzalimited.com',
      'kavita.acharya@ginzalimited.com',
      'rohit.sethia@ginzalimited.com',
      'arvind.sethia@ginzalimited.com',
      'mis.mumbai@ginzalimited.com',
      'ea.mumbai@ginzalimited.com'
    ];
    
    // Accept standard authorized email list
    if (AUTHORIZED_ADMINS.includes(normalizedInput) || normalizedInput === 'expenses.ginzalimited@gmail.com') {
      setIsAdminLoggedIn(true);
      setAdminLoggedInEmail(normalizedInput);
      setAdminEmailError('');
    } else {
      setAdminEmailError('Access Denied. Email address is not in the authorized Admin / Accounts list.');
    }
  };

  // Admin claim action submission (Approve, Reject, Process, Release)
  const handleAdminAction = async (status: 'Approved' | 'Rejected' | 'Processed' | 'Released') => {
    if (!selectedClaim) return;
    
    setActionStatus({ type: 'updating', message: `Setting claim logs to ${status}...` });

    try {
      const response = await fetch('/api/claims/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedClaim.id,
          status,
          remarks: remarksState,
          claimantEmail: selectedClaim.claimantEmail,
          title: selectedClaim.title,
          amount: selectedClaim.amount,
          rowIndex: (selectedClaim as any).rowIndex,
          branchName: (selectedClaim as any).sheetName,
          adminEmail: adminLoggedInEmail
        })
      });

      const resData = await response.json();
      if (resData.success) {
        setActionStatus({ type: 'success', message: `Successfully saved ${status} state to Sheets.` });
        setTimeout(() => {
          setSelectedClaim(null);
          setRemarksState('');
          setActionStatus({ type: 'idle', message: '' });
        }, 1500);

        // Instantly reload database claims so updates represent perfectly!
        fetchClaims();
      } else {
        setActionStatus({ type: 'error', message: resData.error || 'Failed to sync update to Google Sheets.' });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Server update failed: ${err.message}` });
    }
  };

  // Admin delete claim across Sheets, Supabase, Firestore, and fallback JSON
  const handleDeleteClaim = async () => {
    if (!selectedClaim) return;
    
    // Use state-based inline approval/deletion confirmation to prevent iframe sandbox blockages
    if (!deleteSidebarConfirm) {
      setDeleteSidebarConfirm(true);
      return;
    }

    setActionStatus({ type: 'updating', message: `Permanently deleting claim ${selectedClaim.id}...` });
    setDeleteSidebarConfirm(false);

    try {
      const response = await fetch('/api/admin/claims/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimId: selectedClaim.id,
          sheetName: (selectedClaim as any).sheetName || (selectedClaim as any).branch
        })
      });

      const resData = await response.json();
      if (resData.success) {
        let msg = 'Successfully deleted the claim.';
        if (resData.sheetsWarning) {
          msg += ` Note: Google Sheets warning - ${resData.sheetsWarning}. Please ensure your service account has Editor access to the spreadsheet.`;
        }
        setActionStatus({ type: 'success', message: msg });
        setTimeout(() => {
          setSelectedClaim(null);
          setRemarksState('');
          setActionStatus({ type: 'idle', message: '' });
        }, 3500);

        // Instantly reload claims in UI!
        fetchClaims();
      } else {
        setActionStatus({ type: 'error', message: resData.error || 'Failed to delete claim.' });
      }
    } catch (err: any) {
      setActionStatus({ type: 'error', message: `Server deletion failed: ${err.message}` });
    }
  };

  // Group claims by ID to show as single row per submission ID
  const groupedClaims = React.useMemo(() => {
    const map: { [key: string]: any } = {};
    claims.forEach(c => {
      const id = c.id || "Unknown";
      if (!map[id]) {
        map[id] = {
          id,
          submitDate: c.submitDate,
          claimantName: c.claimantName,
          claimantEmail: c.claimantEmail,
          branch: c.branch,
          status: c.status,
          remarks: c.remarks,
          rowIndex: c.rowIndex,
          sheetName: c.sheetName,
          approved: c.approved,
          approvedDetails: c.approvedDetails,
          paymentProcess: c.paymentProcess,
          processedBy: c.processedBy,
          paymentRelease: c.paymentRelease,
          releasedBy: c.releasedBy,
          items: [],
          totalAmount: 0
        };
      }
      map[id].items.push({
        title: c.title,
        description: c.description,
        amount: c.amount,
        category: c.category,
        claimDate: c.claimDate,
        attachmentUrl: c.attachmentUrl
      });
      map[id].totalAmount += Number(c.amount) || 0;
    });
    
    // Sort grouped claims by submit date descending
    return Object.values(map).sort((a: any, b: any) => {
      return new Date(b.submitDate).getTime() - new Date(a.submitDate).getTime();
    });
  }, [claims]);

  // Filters calculation on grouped claims
  const filteredClaims = React.useMemo(() => {
    return groupedClaims.filter(c => {
      const matchesSearch = 
        c.claimantName.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
        c.claimantEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.items.some((item: any) => 
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase())
        );
      
      const matchesBranch = !branchFilter || c.branch === branchFilter;
      
      let matchesStatus = false;
      if (!statusFilter) {
        matchesStatus = true;
      } else if (statusFilter === "Processed" || statusFilter === "Payment Process On Going") {
        matchesStatus = c.status === "Processed" || c.status === "Payment Process On Going";
      } else {
        matchesStatus = c.status === statusFilter;
      }

      return matchesSearch && matchesBranch && matchesStatus;
    });
  }, [groupedClaims, searchQuery, branchFilter, statusFilter]);



  return (
    <div id="app_root" className="min-h-screen bg-slate-50 flex flex-col selection:bg-slate-200">
      
      {/* Visual Navigation Header */}
      <header id="app_header" className="bg-slate-900 text-white shadow-xl px-4 sm:px-8 py-5 border-b border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-white rounded-lg p-1.5 h-12 flex items-center justify-center shadow-lg border border-slate-700/50">
              <img 
                src="https://www.ginzalimited.com/cdn/shop/files/Ginza_logo.jpg?v=1668509673&width=600" 
                alt="GINZA Logo" 
                className="h-full object-contain"
                style={{ maxWidth: '140px' }}
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Ginza Industries
                <span className="text-xs font-semibold px-2 py-0.5 bg-blue-550 bg-opacity-20 text-blue-400 rounded border border-blue-500/30">Expenses Log</span>
              </h1>
              <p className="text-[11px] text-slate-400">Secure Employee Reimbursement & Google Sheets Persistence Portal</p>
            </div>
          </div>
          
          <div className="flex bg-slate-850 p-1 rounded-lg border border-slate-800">
            <button 
              id="raise_tab_btn"
              onClick={() => setActiveTab('raise')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'raise' 
                  ? 'bg-blue-600 text-white shadow' 
                  : 'text-slate-450 hover:text-white hover:bg-slate-800'
              }`}
            >
              Raise Claims Form
            </button>
            <button 
              id="admin_tab_btn"
              onClick={() => setActiveTab('admin')}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                activeTab === 'admin' 
                  ? 'bg-indigo-600 text-white shadow' 
                  : 'text-slate-450 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              Admin tab
            </button>
          </div>
        </div>
      </header>

      {/* Main Body Layout */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-8">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: RAISE CLAIM FORM */}
          {activeTab === 'raise' && (
            <motion.div 
              key="raise-claims"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              
              {/* Left Column: Branch & Policy Info */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Branch Head Contacts Card */}
                <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
                    <Building2 className="h-4.5 w-4.5 text-blue-500" />
                    Selected Branch Information
                  </h3>
                  
                  {/* Select Branch Input */}
                  <div className="mb-5">
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Target Office Branch <span className="text-rose-500">*</span></label>
                    <select 
                      id="branch_select"
                      required
                      value={selectedBranch ? selectedBranch.name : ""} 
                      onChange={(e) => {
                        const br = BRANCHES.find(b => b.name === e.target.value);
                        if (br) {
                          setSelectedBranch(br);
                          setSelectedSalesperson('custom');
                        } else {
                          setSelectedBranch(null);
                          setSelectedSalesperson('custom');
                        }
                      }}
                      className="w-full bg-slate-50 border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                      <option value="">-- Select Branch --</option>
                      {BRANCHES.map(b => (
                        <option key={b.name} value={b.name}>{b.name} Branch</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4 pt-2">
                    {selectedBranch ? (
                      <div className="bg-blue-50 bg-opacity-50 rounded-lg p-4 border border-blue-100">
                        <p className="text-[10px] uppercase tracking-wider font-bold text-blue-600 mb-2">Branch Head</p>
                        <h4 className="text-sm font-bold text-slate-800">{selectedBranch.headName}</h4>
                        <div className="space-y-1.5 mt-3 text-xs text-slate-600">
                          <p className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 text-slate-400" />
                            {selectedBranch.headEmail}
                          </p>
                          <p className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            +91 {selectedBranch.headPhone}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 rounded-lg p-4 border border-slate-150 text-center">
                        <p className="text-xs text-slate-500 italic">Please select a Target Office Branch to view the assigned Branch Head and details.</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Right Column: Submission Form */}
              <form id="expense_claim_form" onSubmit={handleSubmitClaim} className="lg:col-span-8 bg-white rounded-xl shadow-md border border-slate-200 p-6 sm:p-8 space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-indigo-500" />
                    Enter Expense Claim Log Details
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Please provide accurate transaction info and attachments. This will append a secure database row to the Google Spreadsheet logs.</p>
                </div>

                {formStatus.type !== 'idle' && (
                  <div className={`p-4 rounded-lg text-sm flex items-start gap-3 border ${
                    formStatus.type === 'submitting' 
                      ? 'bg-blue-50 text-blue-800 border-blue-200' 
                      : formStatus.type === 'success' 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    {formStatus.type === 'submitting' && <RefreshCw className="h-5 w-5 text-blue-500 animate-spin mt-0.5 flex-shrink-0" />}
                    {formStatus.type === 'success' && <CheckCircle className="h-5 w-5 text-emerald-500 mt-0.5 flex-shrink-0" />}
                    {formStatus.type === 'error' && <XCircle className="h-5 w-5 text-rose-500 mt-0.5 flex-shrink-0" />}
                    <p className="font-medium">{formStatus.message}</p>
                  </div>
                )}

                {/* Section 1: Claimant Profile Identification */}
                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    1. Claimant Identification
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Select Salesperson Profile</label>
                      <select 
                        id="salesperson_select"
                        value={selectedSalesperson === 'custom' ? 'custom' : selectedSalesperson.email} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'custom') {
                            setSelectedSalesperson('custom');
                          } else {
                            if (selectedBranch) {
                              const found = selectedBranch.salespeople.find(s => s.email === val);
                              if (found) setSelectedSalesperson(found);
                            }
                          }
                        }}
                        disabled={!selectedBranch}
                        className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        {selectedBranch ? (
                          <>
                            <option value="custom">-- Select Claimant --</option>
                            {selectedBranch.salespeople.map(s => (
                              <option key={s.email} value={s.email}>{s.name} ({s.email})</option>
                            ))}
                            <option value="custom">-- Custom Claimant (Specify Details) --</option>
                          </>
                        ) : (
                          <option value="custom">-- Select Branch First --</option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-750 mb-1">Claimant Name <span className="text-rose-500">*</span></label>
                      <input 
                        id="claimant_name_input"
                        type="text" 
                        required
                        disabled={selectedSalesperson !== 'custom'}
                        value={claimantName}
                        onChange={(e) => setClaimantName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-550"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-750 mb-1">Claimant Email Address <span className="text-rose-500">*</span></label>
                    <input 
                      id="claimant_email_input"
                      type="email" 
                      required
                      disabled={selectedSalesperson !== 'custom'}
                      value={claimantEmail}
                      onChange={(e) => setClaimantEmail(e.target.value)}
                      placeholder="employee@ginzalimited.com"
                      className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-550"
                    />
                  </div>
                </div>

                {/* Section 2: Expense Core Logs */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      2. Expense Log Info
                    </h3>
                    <button
                      type="button"
                      onClick={handleAddLine}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[11px] font-bold rounded-lg flex items-center gap-1 border border-indigo-200 transition-colors"
                    >
                      <span>+ Add Row / Field Claim</span>
                    </button>
                  </div>

                  <div className="space-y-4">
                    {expenseLines.map((line, index) => (
                      <div key={line.id} className="relative p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-500">Claim Row Item #{index + 1}</span>
                          {expenseLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.id)}
                              className="text-[11px] text-rose-500 hover:text-rose-700 font-bold flex items-center gap-0.5 transition-colors"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Remove Row
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Category <span className="text-rose-500">*</span></label>
                            <select 
                              value={line.category} 
                              onChange={(e) => handleUpdateLine(line.id, 'category', e.target.value)}
                              className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                            >
                              <option value="">-- Select Category --</option>
                              {CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">Transaction Date <span className="text-rose-500">*</span></label>
                            <div className="relative">
                              <input 
                                type="date" 
                                required
                                value={line.claimDate}
                                onChange={(e) => handleUpdateLine(line.id, 'claimDate', e.target.value)}
                                className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        </div>

                        {line.category === 'Travel' ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Origin (From) <span className="text-rose-500">*</span></label>
                              <input 
                                type="text" 
                                required
                                value={line.origin || ''}
                                onChange={(e) => handleUpdateLine(line.id, 'origin', e.target.value)}
                                placeholder="e.g. Mumbai Office"
                                className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Destination (To) <span className="text-rose-500">*</span></label>
                              <input 
                                type="text" 
                                required
                                value={line.destination || ''}
                                onChange={(e) => handleUpdateLine(line.id, 'destination', e.target.value)}
                                placeholder="e.g. Surat Factory"
                                className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Cost (INR - ₹) <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-medium text-sm">₹</span>
                                <input 
                                  type="number" 
                                  required
                                  min="1"
                                  step="0.01"
                                  value={line.amount}
                                  onChange={(e) => handleUpdateLine(line.id, 'amount', e.target.value)}
                                  placeholder="2450.00"
                                  className="w-full bg-white border border-slate-250 py-2 pl-7 pr-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Expense Title / Title <span className="text-rose-500">*</span></label>
                              <input 
                                type="text" 
                                required
                                value={line.title}
                                onChange={(e) => handleUpdateLine(line.id, 'title', e.target.value)}
                                placeholder="Client Meeting hotel fare / stationery etc."
                                className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">Cost (INR - ₹) <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-medium text-sm">₹</span>
                                <input 
                                  type="number" 
                                  required
                                  min="1"
                                  step="0.01"
                                  value={line.amount}
                                  onChange={(e) => handleUpdateLine(line.id, 'amount', e.target.value)}
                                  placeholder="2450.00"
                                  className="w-full bg-white border border-slate-250 py-2 pl-7 pr-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-medium text-slate-705 mb-1">Remark</label>
                          <textarea 
                            rows={2}
                            value={line.description}
                            onChange={(e) => handleUpdateLine(line.id, 'description', e.target.value)}
                            placeholder="Add any additional remarks, passengers, context, etc."
                            className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        {/* Row item local receipt attachment */}
                        <div className="pt-2 border-t border-slate-150">
                          <label className="block text-xs font-bold text-slate-650 mb-1 flex items-center gap-1">
                            <Upload className="h-3 w-3 text-slate-400" />
                            Receipt Attachment (Optional for this item)
                          </label>
                          
                          {line.fileName ? (
                            <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 border border-emerald-250 text-xs text-slate-800">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <FileCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                <span className="font-semibold text-emerald-800 truncate" title={line.fileName}>{line.fileName}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  handleUpdateLine(line.id, 'fileName', '');
                                  handleUpdateLine(line.id, 'fileBase64', '');
                                  handleUpdateLine(line.id, 'fileType', '');
                                }}
                                className="text-[10px] font-bold text-rose-500 hover:text-rose-750 bg-white py-0.5 px-2 rounded border border-rose-100 hover:border-rose-300 shadow-sm flex-shrink-0 transition-colors cursor-pointer"
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                type="file"
                                id={`file_input_${line.id}`}
                                className="hidden"
                                accept="image/*,application/pdf"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    const selectedFile = e.target.files[0];
                                    const reader = new FileReader();
                                    reader.readAsDataURL(selectedFile);
                                    reader.onload = () => {
                                      handleUpdateLine(line.id, 'fileName', selectedFile.name);
                                      handleUpdateLine(line.id, 'fileBase64', reader.result as string);
                                      handleUpdateLine(line.id, 'fileType', selectedFile.type);
                                    };
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  document.getElementById(`file_input_${line.id}`)?.click();
                                }}
                                className="w-full px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                              >
                                <Upload className="h-3 w-3 text-slate-400" />
                                Browse/Upload Receipt (Img, PDF)
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions Panel */}
                <div className="pt-4 border-t border-slate-150 flex justify-end">
                  <button 
                    id="submit_claim_btn"
                    type="submit"
                    disabled={formStatus.type === 'submitting'}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded-lg text-sm shadow-md transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {formStatus.type === 'submitting' ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Logging Claim...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Submit Expense Claim Log
                      </>
                    )}
                  </button>
                </div>

              </form>

            </motion.div>
          )}

          {/* TAB 2: ADMIN SECURE LOG CONSOLE */}
          {activeTab === 'admin' && (
            <motion.div 
              key="admin-claims"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              
              {/* ADMIN LOGIN LOCK SCREEN */}
              {!isAdminLoggedIn ? (
                <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden mt-8">
                  <div className="bg-indigo-900 text-white p-6 text-center space-y-2">
                    <Lock className="h-10 w-10 mx-auto text-indigo-400" />
                    <h3 className="text-lg font-bold">Secure Admin Console Area</h3>
                    <p className="text-xs text-indigo-200">Only authorized Admin &amp; Accounts emails can access management panels</p>
                  </div>
                  
                  <form onSubmit={handleAdminVerify} className="p-6 space-y-4">
                    {adminEmailError && (
                      <div className="p-3 bg-rose-50 text-rose-800 text-xs rounded border border-rose-100 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                        <span>{adminEmailError}</span>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Enter Admin Email Address</label>
                      <input 
                        id="admin_email_input"
                        type="email" 
                        required
                        value={adminEmailInput}
                        onChange={(e) => setAdminEmailInput(e.target.value)}
                        placeholder="mis.mumbai@ginzalimited.com"
                        className="w-full bg-slate-50 border border-slate-250 py-2.5 px-3 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="bg-slate-50 border border-slate-150 p-3 rounded-lg space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Authorized Admin / Accounts Emails:</p>
                      <ul className="grid grid-cols-1 gap-1 text-[11px] text-slate-600 font-mono list-disc pl-4">
                        <li>cash.udhna@ginzalimited.com</li>
                        <li>kavita.acharya@ginzalimited.com</li>
                        <li>rohit.sethia@ginzalimited.com</li>
                        <li>arvind.sethia@ginzalimited.com</li>
                        <li>mis.mumbai@ginzalimited.com</li>
                        <li>ea.mumbai@ginzalimited.com</li>
                      </ul>
                    </div>

                    <button 
                      id="admin_login_submit_btn"
                      type="submit"
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg text-sm shadow transition-all flex items-center justify-center gap-1.5"
                    >
                      <Lock className="h-4 w-4" />
                      Verify Security Credentials
                    </button>
                    
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400 bg-slate-50 p-2 rounded">
                        Authorized configuration is parsed securely from Cloud Dev settings.
                      </p>
                    </div>
                  </form>
                </div>
              ) : (
                
                // ADMIN CONSOLE ACTIVE DASHBOARD
                <div className="space-y-6">
                  
                  {/* Top Welcome Title Banner */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">Live Workspace</span>
                        <p className="text-xs text-slate-400">Logged as {adminLoggedInEmail || 'Admin'}</p>
                      </div>
                      <h2 className="text-xl font-extrabold text-slate-950 mt-1 flex items-center gap-2">
                        Ginza Expenses Administration Console
                      </h2>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <button 
                        id="refresh_data_btn"
                        onClick={fetchClaims}
                        disabled={loadingClaims}
                        className="flex-1 sm:flex-initial bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-250 py-2 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${loadingClaims ? 'animate-spin' : ''}`} />
                        Refresh Data
                      </button>
                      
                      <button 
                        id="logout_btn"
                        onClick={() => {
                          setIsAdminLoggedIn(false);
                          setAdminEmailInput('');
                        }}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 py-2 px-3 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Logout
                      </button>
                    </div>
                  </div>

                  {/* Claims secure table container */}
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
                    
                    {/* Header Action Tools */}
                    <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
                      <div>
                        <h3 className="text-md font-extrabold text-slate-900">Submitted Expenses Claims Log Rows</h3>
                        <p className="text-xs text-slate-500">Real-time rows mapped directly from shared Google Spreadsheet workspace.</p>
                      </div>

                      {/* Filters elements */}
                      <div className="flex flex-wrap md:flex-nowrap gap-2.5 items-stretch">
                        <div className="relative min-w-[200px]">
                          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                            <Search className="h-4 w-4" />
                          </span>
                          <input 
                            id="claim_search_input"
                            type="text" 
                            placeholder="Search Claims ID, Name, info..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-slate-50 border border-slate-250 py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full"
                          />
                        </div>

                        <select
                          id="branch_filter_select"
                          value={branchFilter}
                          onChange={(e) => setBranchFilter(e.target.value)}
                          className="bg-slate-50 border border-slate-250 py-1.5 px-2.5 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none"
                        >
                          <option value="">All Branches</option>
                          {BRANCHES.map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </select>

                        <select
                          id="status_filter_select"
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                          className="bg-slate-50 border border-slate-250 py-1.5 px-2.5 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none"
                        >
                          <option value="">All Statuses</option>
                          <option value="Pending">Pending</option>
                          <option value="Approved">Approved</option>
                          <option value="Payment Process On Going">Payment Process On Going</option>
                          <option value="Released">Released</option>
                          <option value="Rejected">Rejected</option>
                          <option value="Processed">Processed (Legacy)</option>
                        </select>
                      </div>
                    </div>

                    {/* Claims list display */}
                    {loadingClaims ? (
                      <div className="py-20 text-center">
                        <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin mx-auto mb-3" />
                        <p className="text-xs text-slate-500 font-medium">Syncing database structures from Google Spreadsheet...</p>
                      </div>
                    ) : filteredClaims.length === 0 ? (
                      <div className="text-center py-16 border rounded-xl bg-slate-50 border-slate-200">
                        <AlertCircle className="h-10 w-10 text-slate-400 mx-auto mb-2" />
                        <h4 className="text-sm font-bold text-slate-800">No Claims matched</h4>
                        <p className="text-xs text-slate-500 mt-1">Adjust your filters parameters or submit a new claims expense above.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                              <th className="py-3 px-4">Claim ID</th>
                              <th className="py-3 px-4">Claimant Info</th>
                              <th className="py-3 px-4">Expense Details</th>
                              <th className="py-3 px-4 text-right">Item Amt</th>
                              <th className="py-3 px-4">Txn Date</th>
                              <th className="py-3 px-4">Receipt</th>
                              <th className="py-3 px-4 text-right">Grand Total</th>
                              <th className="py-3 px-4">Submitted At</th>
                              <th className="py-3 px-4">Status & Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white">
                            {filteredClaims.map((item, idx) => {
                              const subItems = (item.items && item.items.length > 0) ? item.items : [{}];
                              const rowSpanVal = subItems.length;

                              return (
                                <React.Fragment key={`${item.id}-${idx}`}>
                                  {subItems.map((sub: any, sIdx: number) => {
                                    const isLastSub = sIdx === rowSpanVal - 1;
                                    const bgClass = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40';

                                    return (
                                      <tr 
                                        key={`${item.id}-sub-${sIdx}`} 
                                        className={`${bgClass} hover:bg-slate-100/65 transition-colors align-top ${
                                          isLastSub ? 'border-b-2 border-slate-250' : 'border-b border-slate-100/60'
                                        }`}
                                      >
                                        {/* 1. Claim ID (RowSpan) */}
                                        {sIdx === 0 && (
                                          <td 
                                            rowSpan={rowSpanVal} 
                                            className="py-4 px-4 font-bold text-slate-900 font-mono whitespace-nowrap border-r border-slate-100 text-[11px] align-top bg-slate-50/20"
                                          >
                                            {item.id}
                                          </td>
                                        )}

                                        {/* 2. Claimant Info (RowSpan) */}
                                        {sIdx === 0 && (
                                          <td 
                                            rowSpan={rowSpanVal} 
                                            className="py-4 px-4 border-r border-slate-100 align-top"
                                          >
                                            <div className="space-y-1">
                                              <p className="font-extrabold text-slate-800 leading-tight">{item.claimantName}</p>
                                              <p className="text-[10px] text-slate-500 leading-none">{item.claimantEmail}</p>
                                              <span className="inline-block mt-1 font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[9px] border border-slate-200">
                                                {item.branch}
                                              </span>
                                            </div>
                                          </td>
                                        )}

                                        {/* 3. Expense Details (Single Row) */}
                                        <td className="py-4 px-4 max-w-xs md:max-w-md">
                                          <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-50 border border-indigo-200 text-indigo-700">
                                                {sub.category || "General"}
                                              </span>
                                              <span className="font-bold text-slate-800 leading-tight">
                                                {sub.title || "No Title"}
                                              </span>
                                            </div>
                                            {sub.description && (
                                              <p className="text-[10px] text-slate-500 font-medium break-words max-w-xs leading-tight">{sub.description}</p>
                                            )}
                                            
                                            {/* For travelers: route details */}
                                            {(sub.category === 'Travel' && (sub.origin || sub.destination)) && (
                                              <div className="text-[9px] text-slate-450 bg-slate-100/50 p-1.5 rounded border border-slate-200/50 mt-1 inline-block">
                                                <span className="font-semibold text-slate-600 font-sans">Route:</span> {sub.origin || '-'} ➔ {sub.destination || '-'}
                                                {sub.distance && ` (${sub.distance} km)`}
                                              </div>
                                            )}

                                            {/* Admin response log remarks in sIdx === 0 */}
                                            {sIdx === 0 && item.remarks && (
                                              <p className="text-[10px] text-slate-650 bg-amber-50/50 p-2 rounded italic mt-2 border-l-2 border-amber-300 leading-normal max-w-sm">
                                                <strong>Admin:</strong> {item.remarks}
                                              </p>
                                            )}
                                          </div>
                                        </td>

                                        {/* 4. Item Amt (Single Row) */}
                                        <td className="py-4 px-4 font-bold text-slate-800 whitespace-nowrap text-right">
                                          ₹{(Number(sub.amount) || 0).toLocaleString('en-IN')}
                                        </td>

                                        {/* 5. Txn Date (Single Row) */}
                                        <td className="py-4 px-4 text-slate-550 font-medium whitespace-nowrap">
                                          {sub.claimDate || item.submitDate || '-'}
                                        </td>

                                        {/* 6. Receipt (Single Row) */}
                                        <td className="py-4 px-4">
                                          {sub.attachmentUrl ? (
                                            <a 
                                              href={sub.attachmentUrl} 
                                              target="_blank" 
                                              referrerPolicy="no-referrer"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 font-bold text-blue-600 hover:text-blue-800 hover:underline text-[10px] bg-blue-50 border border-blue-200 py-1 px-2 rounded tracking-wide transition-all"
                                              title={`View receipt for ${sub.title || 'item'}`}
                                            >
                                              <Upload className="h-3 w-3 text-blue-500" />
                                              Receipt
                                            </a>
                                          ) : (
                                            <span className="text-[10px] text-slate-400 italic font-medium">No receipt</span>
                                          )}
                                        </td>

                                        {/* 7. Grand Total (RowSpan) */}
                                        {sIdx === 0 && (
                                          <td 
                                            rowSpan={rowSpanVal} 
                                            className="py-4 px-4 font-black whitespace-nowrap text-right bg-slate-50/30 border-l border-slate-100 align-top"
                                          >
                                            <div className="pr-1">
                                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">Grand Total</p>
                                              <p className="text-xs font-black text-blue-700 mt-1">₹{(item.totalAmount || 0).toLocaleString('en-IN')}</p>
                                            </div>
                                          </td>
                                        )}

                                        {/* 8. Submitted Date (RowSpan) */}
                                        {sIdx === 0 && (
                                          <td 
                                            rowSpan={rowSpanVal} 
                                            className="py-4 px-4 whitespace-nowrap text-slate-600 font-semibold border-l border-slate-100 align-top"
                                          >
                                            <div>
                                              <p className="leading-none text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1">Submitted</p>
                                              <p className="font-semibold text-[11px] text-slate-700">{item.submitDate}</p>
                                            </div>
                                          </td>
                                        )}

                                        {/* 9. Status & Action (RowSpan) */}
                                        {sIdx === 0 && (
                                          <td 
                                            rowSpan={rowSpanVal} 
                                            className="py-4 px-4 border-l border-slate-100 align-top"
                                          >
                                            <div className="space-y-2">
                                              <div>
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border leading-none ${
                                                  item.status === 'Approved' 
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-250' 
                                                    : (item.status === 'Processed' || item.status === 'Payment Process On Going')
                                                    ? 'bg-blue-50 text-blue-700 border-blue-250'
                                                    : item.status === 'Released'
                                                    ? 'bg-purple-50 text-purple-755 border-purple-250'
                                                    : item.status === 'Rejected' 
                                                    ? 'bg-rose-50 text-rose-700 border-rose-250' 
                                                    : 'bg-amber-50 text-amber-700 border-amber-250'
                                                }`}>
                                                  {item.status || 'Pending'}
                                                </span>
                                              </div>
                                              
                                              <div className="flex items-center gap-1.5 flex-wrap">
                                                <button 
                                                  onClick={() => {
                                                    setSelectedClaim(item);
                                                    setRemarksState(item.remarks || '');
                                                  }}
                                                  className={`py-1 px-2 rounded font-semibold text-[10px] shadow-sm transition-all cursor-pointer ${
                                                    item.status === 'Pending'
                                                      ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 border border-indigo-200'
                                                      : item.status === 'Approved'
                                                      ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 hover:text-blue-900 border border-blue-200'
                                                      : (item.status === 'Processed' || item.status === 'Payment Process On Going')
                                                      ? 'bg-purple-50 hover:bg-purple-100 text-purple-700 hover:text-purple-900 border border-purple-200'
                                                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200'
                                                  }`}
                                                >
                                                  {item.status === 'Pending' && 'Resolve'}
                                                  {item.status === 'Approved' && 'Process'}
                                                  {(item.status === 'Processed' || item.status === 'Payment Process On Going') && 'Release'}
                                                  {(item.status === 'Released' || item.status === 'Rejected') && 'View'}
                                                </button>

                                                {deleteConfirmId === item.id ? (
                                                  <div className="flex items-center gap-1 bg-rose-50 px-1 py-0.5 rounded border border-rose-200 animate-fade-in">
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirmId(null);
                                                      }}
                                                      className="px-1.5 py-0.5 text-[9px] hover:bg-rose-105 text-slate-600 rounded transition-all cursor-pointer font-bold"
                                                      title="Cancel deletion"
                                                    >
                                                      No
                                                    </button>
                                                    <button
                                                      onClick={async (e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirmId(null);
                                                        setActionStatus({ type: 'updating', message: `Permanently deleting claim ${item.id}...` });
                                                        try {
                                                          const response = await fetch('/api/admin/claims/delete', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                              claimId: item.id,
                                                              sheetName: (item as any).sheetName || item.branch
                                                            })
                                                          });
                                                          const resData = await response.json();
                                                          if (resData.success) {
                                                            let msg = 'Successfully deleted the claim.';
                                                            if (resData.sheetsWarning) {
                                                              msg += ` Note: Google Sheets warning - ${resData.sheetsWarning}. Please ensure your service account has Editor access to the spreadsheet.`;
                                                            }
                                                            setActionStatus({ type: 'success', message: msg });
                                                            setTimeout(() => setActionStatus({ type: 'idle', message: '' }), 3500);
                                                            fetchClaims();
                                                          } else {
                                                            setActionStatus({ type: 'error', message: resData.error || 'Failed to delete.' });
                                                          }
                                                        } catch (err: any) {
                                                          setActionStatus({ type: 'error', message: err.message });
                                                        }
                                                      }}
                                                      className="px-1.5 py-0.5 text-[9px] bg-rose-600 hover:bg-rose-700 text-white rounded transition-all cursor-pointer font-bold"
                                                      title="Confirm permanent delete"
                                                    >
                                                      Yes
                                                    </button>
                                                  </div>
                                                ) : (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setDeleteConfirmId(item.id);
                                                    }}
                                                    title="Permanently Delete Claim"
                                                    className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-650 hover:text-rose-800 border border-rose-250 rounded cursor-pointer transition-all flex items-center justify-center animate-pulse"
                                                  >
                                                    <Trash2 className="h-3 w-3" />
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </td>
                                        )}
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                  </div>

                </div>
              )}

            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ADMIN ACTION DIALOG POPUP / REMARKS DRAWER */}
      <AnimatePresence>
        {selectedClaim && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden"
            >
              
              <div className="bg-slate-900 text-white p-5 border-b border-slate-800 flex justify-between items-center">
                <div>
                  <h3 className="font-extrabold text-sm flex items-center gap-2">
                    <User className="h-4.5 w-4.5 text-indigo-400" />
                    Review Claim: {selectedClaim.id}
                  </h3>
                  <p className="text-[10px] text-slate-400">Validate Claimant Details and Google Sheet persistent outcomes</p>
                </div>
                <button 
                  onClick={() => setSelectedClaim(null)}
                  className="text-slate-400 hover:text-white text-lg font-bold"
                >
                  &times;
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                
                {actionStatus.type !== 'idle' && (
                  <div className={`p-3 rounded text-xs flex items-center gap-2 border ${
                    actionStatus.type === 'updating' 
                      ? 'bg-blue-50 text-blue-800 border-blue-200' 
                      : actionStatus.type === 'success' 
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    {actionStatus.type === 'updating' && <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />}
                    {actionStatus.type === 'success' && <CheckCircle className="h-4 w-4 text-emerald-500" />}
                    <p className="font-bold">{actionStatus.message}</p>
                  </div>
                )}

                <div className="bg-slate-50 rounded p-4 text-xs space-y-2 border border-slate-200">
                  <p><strong className="text-slate-450 uppercase text-[9px] tracking-wide block">Employee:</strong> {selectedClaim.claimantName} ({selectedClaim.claimantEmail})</p>
                  <p><strong className="text-slate-450 uppercase text-[9px] tracking-wide block">Branch Office:</strong> {selectedClaim.branch}</p>
                  <p><strong className="text-slate-450 uppercase text-[9px] tracking-wide block font-bold">Total Amount to Reimburse:</strong> <span className="text-slate-950 font-extrabold text-sm">₹{(selectedClaim.totalAmount || selectedClaim.amount || 0).toLocaleString('en-IN')}</span></p>
                  
                  {/* List of items */}
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <p className="font-bold text-[9px] text-slate-450 uppercase tracking-wide">Expense Items ({selectedClaim.items?.length || 1})</p>
                    {(selectedClaim.items || [{ title: selectedClaim.title, description: selectedClaim.description, amount: selectedClaim.amount, category: selectedClaim.category, claimDate: selectedClaim.claimDate, attachmentUrl: selectedClaim.attachmentUrl }]).map((sub: any, sIdx: number) => (
                      <div key={sIdx} className="p-2 rounded bg-white border border-slate-150 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-800 leading-tight block">{sub.title || "No Title"}</span>
                          <span className="inline-block text-[8px] font-bold text-indigo-700 bg-indigo-50 px-1 border border-indigo-100 rounded">
                            {sub.category}
                          </span>
                        </div>
                        {sub.description && (
                          <p className="text-[10px] text-slate-500 break-words leading-tight">{sub.description}</p>
                        )}
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-medium">
                          <span>Date: {sub.claimDate}</span>
                          <span className="font-bold text-slate-755">₹{(Number(sub.amount) || 0).toLocaleString('en-IN')}</span>
                        </div>
                        {sub.attachmentUrl && (
                          <div className="pt-1">
                            <a 
                              href={sub.attachmentUrl} 
                              target="_blank" 
                              referrerPolicy="no-referrer"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-600 hover:text-blue-800 underline font-semibold flex items-center gap-0.5"
                            >
                              View Receipt Invoice
                            </a>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status workflow stage tracker */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-[10px]">
                  <div className={`p-2 rounded border ${
                    (selectedClaim as any).approved === 'Yes' || selectedClaim.status === 'Approved' || selectedClaim.status === 'Processed' || selectedClaim.status === 'Payment Process On Going' || selectedClaim.status === 'Released'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-850 font-medium' 
                      : 'bg-slate-50 border-slate-250 text-slate-500'
                  }`}>
                    <p className="font-bold text-slate-900 border-b border-slate-100 pb-0.5 mb-1 text-[10.5px]">1. Approved</p>
                    <p className="text-[9px] leading-tight text-slate-600">
                      {(selectedClaim as any).approved === 'Yes' 
                        ? ((selectedClaim as any).approvedDetails || 'Approved by Admin') 
                        : 'Pending Approval'}
                    </p>
                  </div>
                  <div className={`p-2 rounded border ${
                    (selectedClaim as any).paymentProcess === 'Yes' || selectedClaim.status === 'Processed' || selectedClaim.status === 'Payment Process On Going' || selectedClaim.status === 'Released'
                      ? 'bg-blue-50 border-blue-200 text-blue-800 font-medium' 
                      : 'bg-slate-50 border-slate-250 text-slate-500'
                  }`}>
                    <p className="font-bold text-slate-900 border-b border-slate-100 pb-0.5 mb-1 text-[10.5px]">2. Payment Process</p>
                    <p className="text-[9px] leading-tight text-slate-600">
                      {(selectedClaim as any).paymentProcess === 'Yes' 
                        ? ((selectedClaim as any).processedBy || 'Processed (Accounts)') 
                        : 'Awaiting Accounts'}
                    </p>
                  </div>
                  <div className={`p-2 rounded border ${
                    (selectedClaim as any).paymentRelease === 'Yes' || selectedClaim.status === 'Released'
                      ? 'bg-purple-50 border-purple-200 text-purple-800 font-medium' 
                      : 'bg-slate-50 border-slate-250 text-slate-500'
                  }`}>
                    <p className="font-bold text-slate-900 border-b border-slate-100 pb-0.5 mb-1 text-[10.5px]">3. Payment Release</p>
                    <p className="text-[9px] leading-tight text-slate-600">
                      {(selectedClaim as any).paymentRelease === 'Yes' 
                        ? ((selectedClaim as any).releasedBy || 'Released (Paid)') 
                        : 'Awaiting Release'}
                    </p>
                  </div>
                </div>

                {selectedClaim.status === 'Pending' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Administrative Remarks / Action Reason (Sent to claimant)</label>
                    <textarea 
                      rows={2}
                      value={remarksState}
                      onChange={(e) => setRemarksState(e.target.value)}
                      placeholder="Enter approval details, accounts instructions, or rejection reasons..."
                      className="w-full bg-white border border-slate-250 py-2 px-3 rounded-lg text-xs text-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 font-semibold text-xs">
                  {selectedClaim.status === 'Pending' && (
                    <>
                      <button 
                        id="reject_claim_btn"
                        onClick={() => handleAdminAction('Rejected')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-250 font-bold py-2.5 rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <XCircle className="h-4 w-4 text-rose-500" />
                        Reject Expense & Email
                      </button>
                      <button 
                        id="approve_claim_btn"
                        onClick={() => handleAdminAction('Approved')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-lg text-xs shadow transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Approve Expense & Email
                      </button>
                    </>
                  )}

                  {selectedClaim.status === 'Approved' && (
                    <>
                      <button 
                        id="reject_claim_btn"
                        onClick={() => handleAdminAction('Rejected')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-250 font-bold py-2.5 rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <XCircle className="h-4 w-4 text-rose-500" />
                        Reject / Revert
                      </button>
                      <button 
                        id="process_payment_btn"
                        onClick={() => handleAdminAction('Processed')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg text-xs shadow transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Send className="h-4 w-4" />
                        Process Payment (Email Accounts)
                      </button>
                    </>
                  )}

                  {(selectedClaim.status === 'Processed' || selectedClaim.status === 'Payment Process On Going') && (
                    <>
                      <button 
                        id="reject_claim_btn"
                        onClick={() => handleAdminAction('Rejected')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-250 font-bold py-2.5 rounded-lg text-xs shadow-sm transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <XCircle className="h-4 w-4 text-rose-500" />
                        Cancel / Reject
                      </button>
                      <button 
                        id="release_payment_btn"
                        onClick={() => handleAdminAction('Released')}
                        disabled={actionStatus.type === 'updating'}
                        className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-lg text-xs shadow transition-all flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Check className="h-4 w-4" />
                        Release Payment (Email Claimant)
                      </button>
                    </>
                  )}

                  {(selectedClaim.status === 'Released' || selectedClaim.status === 'Rejected') && (
                    <div className="col-span-2 text-center py-2 px-4 rounded bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold">
                      This transaction has been finalized as <span className="font-bold text-slate-800 underline">{selectedClaim.status}</span>. No further action is required.
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex flex-col sm:flex-row justify-between items-center gap-2">
                    <div>
                      <p className="text-xs font-bold text-rose-800">Dangerous Administrative Action</p>
                      <p className="text-[10px] text-rose-600 leading-tight">Permanently delete this claim across Google Sheets, Supabase, Firestore, and local caches.</p>
                    </div>
                    {deleteSidebarConfirm ? (
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                          onClick={() => setDeleteSidebarConfirm(false)}
                          className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded text-[11px] transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleDeleteClaim}
                          className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[11px] hover:shadow transition-all cursor-pointer"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    ) : (
                      <button
                        id="delete_claim_btn"
                        onClick={handleDeleteClaim}
                        disabled={actionStatus.type === 'updating'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded text-[11px] shadow hover:shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Claim
                      </button>
                    )}
                  </div>
                </div>

              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Simple Footer footer matches corporate look */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 py-6 px-4 text-center text-xs mt-12">
        <div className="max-w-7xl mx-auto space-y-1.5 font-mono">
          <p>&copy; 2026 Ginza Industries Limited &bull; Confidential &bull; All Rights Reserved</p>
          <p className="text-[10px] text-slate-500">Google Sheets Dashboard Connection Status: Connected &bull; SMTP Mail Relay: Connected</p>
        </div>
      </footer>

    </div>
  );
}
