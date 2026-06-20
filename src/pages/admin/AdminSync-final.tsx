import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { fetchFromGoogleSheet, fetchSheetNames } from '@/lib/sheetService';
import { useAuth } from '@/context/AuthContext';
import { saveTeacherSheetMapping } from '@/services/teacherService';
import { extractSheetIdFromUrl } from '@/lib/sheetService';
import {
  FileSpreadsheet,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  Loader2,
  Info,
  Trash2,
  Plus
} from 'lucide-react';

interface SyncRecord {
  id: number;
  date: string;
  records: number;
  status: 'success' | 'partial' | 'failed';
}

import { ClassSheet } from '@/types';



import { useClass } from '@/context/ClassContext';

export default function AdminSync() {
  const { user, isSuperAdmin } = useAuth();
  const { classes: classSheets, refreshClasses, changeClass, selectedClassId, addClass, removeClass, updateClass } = useClass();
  const [sheetUrl, setSheetUrl] = useState('');
  const [className, setClassName] = useState('');
  const [sheetTab, setSheetTab] = useState(''); // optional: default Sheet1
  const [apiKey, setApiKey] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isManualMigrating, setIsManualMigrating] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncRecord[]>([
    { id: 1, date: '2024-12-20 10:30 AM', records: 8, status: 'success' },
    { id: 2, date: '2024-12-19 09:45 AM', records: 8, status: 'success' },
    { id: 3, date: '2024-12-18 10:00 AM', records: 7, status: 'partial' },
  ]);
  const [selectedClassData, setSelectedClassData] = useState<any[]>([]);
  // Multi-sheet tab support
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const savedApiKey = localStorage.getItem('google_sheets_api_key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    } else if (user?.apiKey) {
      // Fallback to Firestore user data if local storage is empty
      setApiKey(user.apiKey);
      localStorage.setItem('google_sheets_api_key', user.apiKey); // Save to local for future
    }

    // Initial load handled by context
    if (classSheets.length > 0 && !selectedClassId) {
      // If context has classes but none selected, select first
      changeClass(classSheets[0].id);
      loadClassData(classSheets[0].id);
    } else if (selectedClassId) {
      loadClassData(selectedClassId);
    }


    const autoSyncInterval = setInterval(() => {
      handleAutoSync();
    }, 5 * 60 * 1000);

    return () => clearInterval(autoSyncInterval);
  }, [user?.uid, classSheets.length, selectedClassId]); // Re-run if classes change or selected class changes

  // Removed loadClassSheets as it is handled by context

  const handleAddClass = async () => {
    if (!sheetUrl.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter a Google Sheet URL',
      });
      return;
    }

    if (!className.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter class name',
      });
      return;
    }

    if (!apiKey.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter your Google Sheets API Key',
      });
      return;
    }

    setIsSyncing(true);

    try {
      const sheetId = extractSheetIdFromUrl(sheetUrl);
      if (!sheetId) {
        throw new Error('Invalid Google Sheets URL');
      }

      const tabName = sheetTab.trim() || 'Sheet1';
      console.log(`🔍 Syncing sheet: ${sheetId}, tab: ${tabName}`);

      const records = await fetchFromGoogleSheet(sheetId, apiKey, `${tabName}!A2:F`);

      if (records.length === 0) {
        throw new Error(
          `No readable attendance data found in tab "${tabName}". ` +
          `Make sure your sheet has data in columns: RollNo | Name | Date | Time | Status (starting row 2). ` +
          `Also verify the tab name matches exactly (case-sensitive).`
        );
      }

      localStorage.setItem('google_sheets_api_key', apiKey);

      // ✅ Create class sheet
      const newClassSheet: ClassSheet = {
        id: `class-${Date.now()}`,
        adminId: user?.uid || '',
        className: className,
        sheetId: sheetId,
        sheetUrl: sheetUrl,
        lastSyncedAt: new Date().toLocaleString(),
        recordsCount: records.length,
        isAutoSync: true,
        sheetTab: tabName,
      };

      // ✅ Cloud Save via Context
      await addClass(newClassSheet);

      // ✅ Save actual attendance data (Local Cache)
      localStorage.setItem(`class_data_${newClassSheet.id}`, JSON.stringify(records));
      console.log(`✅ Saved class_data_${newClassSheet.id}: ${records.length} records`);

      // ✅ Wrapper functions will handle UI updates

      // ✅ Save teacher's sheet mapping (so it's remembered after logout)
      saveTeacherSheetMapping(user?.uid || '', {
        sheetUrl,
        apiKey,
        className,
        adminName: user?.name || '',
        adminEmail: user?.email || '',
        role: (user?.role === 'super_admin' || user?.role === 'admin') ? user.role : 'admin'
      });

      console.log(`✅ Mapping saved for ${user?.email}`);

      const newSync: SyncRecord = {
        id: syncHistory.length + 1,
        date: new Date().toLocaleString(),
        records: records.length,
        status: 'success',
      };
      setSyncHistory([newSync, ...syncHistory]);

      toast({
        title: 'Class Added! ✅',
        description: `${className} (tab: ${tabName}) with ${records.length} records added successfully.`,
      });

      setSheetUrl('');
      setClassName('');
      setSheetTab('');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAutoSync = async () => {
    for (const sheet of classSheets) {
      if (sheet.isAutoSync && apiKey) {
        try {
          const records = await fetchFromGoogleSheet(sheet.sheetId, apiKey);
          localStorage.setItem(`class_data_${sheet.id}`, JSON.stringify(records));

          // Update Cloud
          await updateClass({
            ...sheet,
            lastSyncedAt: new Date().toLocaleString(),
            recordsCount: records.length
          });

          console.log(`✅ Auto-synced ${sheet.className}: ${records.length} records`);
        } catch (error) {
          console.error(`❌ Auto-sync failed for ${sheet.className}:`, error);
        }
      }
    }
  };

  const loadClassData = async (classId: string) => {
    const data = JSON.parse(localStorage.getItem(`class_data_${classId}`) || '[]');
    setSelectedClassData(data);

    // Load available tabs for this class
    const sheet = classSheets.find(s => s.id === classId);
    if (sheet?.sheetId && apiKey) {
      setIsLoadingTabs(true);
      const tabs = await fetchSheetNames(sheet.sheetId, apiKey);
      setAvailableTabs(tabs);
      setActiveTab(sheet.sheetTab || 'Sheet1');
      setIsLoadingTabs(false);
    } else {
      setAvailableTabs([]);
      setActiveTab(sheet?.sheetTab || 'Sheet1');
    }
  };

  const handleManualSync = async (classId: string, tabOverride?: string) => {
    const sheet = classSheets.find(s => s.id === classId);
    if (!sheet) return;

    if (!apiKey) {
      toast({
        variant: "destructive",
        title: "API Key Missing",
        description: "Please enter your Google Sheets API Key in the 'Add New Class' section above or re-login."
      });
      return;
    }

    const tabName = tabOverride || sheet.sheetTab || 'Sheet1';

    try {
      const records = await fetchFromGoogleSheet(sheet.sheetId!, apiKey, `${tabName}!A2:F`);
      localStorage.setItem(`class_data_${classId}`, JSON.stringify(records));

      // Update Cloud (update sheetTab too if changed)
      await updateClass({
        ...sheet,
        lastSyncedAt: new Date().toLocaleString(),
        recordsCount: records.length,
        sheetTab: tabName,
      });

      setSelectedClassData(records);
      setActiveTab(tabName);

      toast({
        title: `Synced! ✅`,
        description: `${sheet.className} → ${tabName}: ${records.length} records`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `Failed to sync tab "${tabName}"`,
      });
    }
  };

  const handleDeleteClass = async (classId: string) => {
    try {
      await removeClass(classId);
      localStorage.removeItem(`class_data_${classId}`);

      // Selection logic handled in Context or UI effect
      if (selectedClassId === classId) {
        setSelectedClassData([]);
      }

      toast({
        title: 'Class Removed',
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove class',
      });
    }
  };

  const toggleAutoSync = async (classId: string) => {
    const sheet = classSheets.find(s => s.id === classId);
    if (!sheet) return;

    const updated = { ...sheet, isAutoSync: !sheet.isAutoSync };
    await updateClass(updated);

    toast({
      title: 'Updated',
      description: `Auto-sync ${updated.isAutoSync ? 'enabled' : 'disabled'}`,
    });
  };

  const handleForceCloudSync = async () => {
    if (!user?.uid) return;
    try {
      setIsManualMigrating(true);
      const localData = localStorage.getItem(`class_sheets_${user.uid}`);
      if (!localData) {
        toast({ title: "No Local Data", description: "No classes found on this device to sync." });
        return;
      }
      const localClasses: ClassSheet[] = JSON.parse(localData);

      let count = 0;
      for (const cls of localClasses) {
        // Only add if not already in context
        if (!classSheets.some(c => c.id === cls.id)) {
          await addClass(cls);
          count++;
        }
      }

      toast({
        title: "Cloud Sync Complete",
        description: count > 0 ? `Successfully pushed ${count} classes to cloud.` : "Cloud is already up to date with this device."
      });

    } catch (error) {
      console.error("Force sync failed", error);
      toast({ variant: "destructive", title: "Sync Failed", description: "Could not push data to cloud." });
    } finally {
      setIsManualMigrating(false);
    }
  };

  // Super Admin view
  if (isSuperAdmin) {
    return (
      <div className="space-y-6 sm:space-y-8 animate-fade-in w-full">
        <div className="px-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Sync Management (Super Admin)</h1>
          <p className="text-xs sm:text-base text-muted-foreground mt-1">
            View all synced classes from teachers
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Teacher Classes</CardTitle>
            <CardDescription>Classes synced by all teachers</CardDescription>
          </CardHeader>
          <CardContent>
            {classSheets.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No classes synced yet</p>
            ) : (
              <div className="space-y-3">
                {classSheets.map((sheet) => (
                  <div key={sheet.id} className="border p-4 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold">{sheet.className}</p>
                        <p className="text-sm text-muted-foreground">Teacher ID: {sheet.adminId}</p>
                      </div>
                      <Badge variant="outline">{sheet.recordsCount} records</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Last synced: {sheet.lastSyncedAt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Regular Teacher view
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in w-full">
      <div className="px-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Manage Classes</h1>
        <p className="text-xs sm:text-base text-muted-foreground mt-1">
          Add and manage Google Sheets for different classes
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add New Class
          </CardTitle>
          <CardDescription>Connect a Google Sheet for a class</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex gap-2">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900 dark:text-blue-200">
              <p className="font-semibold mb-1">Add your class's Google Sheet:</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs">
                <li>Create Google Sheet with attendance data</li>
                <li>Get API Key from Google Cloud Console</li>
                <li>Share sheet link below</li>
                <li>After adding, your data will be remembered after logout ✓</li>
              </ol>
            </div>
          </div>

          <div>
            <Label>Class Name (e.g., 10-A, 12-B)</Label>
            <Input
              placeholder="Class name"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            />
          </div>

          <div>
            <Label>Google Sheet URL</Label>
            <Input
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
          </div>

          <div>
            <Label>
              Sheet Tab Name{' '}
              <span className="text-xs text-muted-foreground font-normal">(optional — default: Sheet1)</span>
            </Label>
            <Input
              placeholder="e.g. January, February, Sheet2"
              value={sheetTab}
              onChange={(e) => setSheetTab(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave blank to use Sheet1. You can switch tabs after adding the class.
            </p>
          </div>

          <div>
            <Label>API Key</Label>
            <div className="flex gap-2 flex-col sm:flex-row">
              <Input
                type="password"
                placeholder="Your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => localStorage.setItem('google_sheets_api_key', apiKey)}
                className="w-full sm:w-auto"
              >
                Save Key
              </Button>
            </div>
          </div>

          <Button
            onClick={handleAddClass}
            disabled={isSyncing}
            className="w-full"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Add Class
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Your Classes ({classSheets.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={handleForceCloudSync} disabled={isManualMigrating}>
            {isManualMigrating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Force Cloud Sync
          </Button>
        </CardHeader>
        <CardContent>
          {classSheets.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No classes added yet</p>
          ) : (
            <div className="space-y-3">
              {classSheets.map((sheet) => (
                <div
                  key={sheet.id}
                  className={`border p-4 rounded-lg cursor-pointer transition ${selectedClassId === sheet.id ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  onClick={() => {
                    changeClass(sheet.id);
                    loadClassData(sheet.id);
                  }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <p className="font-semibold text-lg">{sheet.className}</p>
                      <p className="text-sm text-muted-foreground">
                        Last synced: {sheet.lastSyncedAt}
                      </p>
                    </div>
                    <Badge variant="outline">{sheet.recordsCount} records</Badge>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleManualSync(sheet.id);
                      }}
                    >
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Sync Now
                    </Button>

                    <Button
                      variant={sheet.isAutoSync ? 'default' : 'outline'}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAutoSync(sheet.id);
                      }}
                    >
                      Auto Sync {sheet.isAutoSync ? '✓' : '✗'}
                    </Button>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClass(sheet.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedClassId && (
        <Card>
          <CardHeader>
            <CardTitle>
              {classSheets.find(s => s.id === selectedClassId)?.className} — {activeTab}
            </CardTitle>
            <CardDescription>{selectedClassData.length} records</CardDescription>
          </CardHeader>

          {/* Month / Tab Switcher — full width, mobile-friendly */}
          {availableTabs.length > 1 && (
            <div className="px-6 pb-3">
              {isLoadingTabs ? (
                <span className="text-xs text-muted-foreground">Loading tabs...</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableTabs.map(tab => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={activeTab === tab ? 'default' : 'outline'}
                      className="text-xs h-8 px-4"
                      onClick={() => handleManualSync(selectedClassId, tab)}
                    >
                      {tab}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Roll No</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedClassData.slice(0, 50).map((record, idx) => (
                    <tr key={idx} className="border-b hover:bg-slate-50 dark:hover:bg-slate-800">
                      <td className="p-2">{record.rollNo}</td>
                      <td className="p-2">{record.name}</td>
                      <td className="p-2">{record.date}</td>
                      <td className="p-2">{record.time}</td>
                      <td className="p-2">
                        <Badge
                          variant={
                            record.status === 'present'
                              ? 'default'
                              : record.status === 'late'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {record.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}