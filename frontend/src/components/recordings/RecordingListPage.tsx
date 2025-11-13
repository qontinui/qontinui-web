'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Upload,
  Play,
  Trash2,
  Eye,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Search,
  Filter,
} from 'lucide-react';
import { RecordingService } from '@/services/recording-service';
import {
  RecordingStatusLabels,
  ProcessingPhaseLabels,
  getConfidenceLevel,
  getConfidenceColor,
} from '@/types/recording';
import type {
  Recording,
  RecordingStatus,
  ProcessingPhase,
  RecordingListResponse,
} from '@/types/recording';
import { formatDistanceToNow } from 'date-fns';

export function RecordingListPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: projects = [] } = useProjects();
  const recordingService = new RecordingService();

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  // Load recordings
  const loadRecordings = async () => {
    try {
      setLoading(true);
      const response = await recordingService.listRecordings(
        projectFilter !== 'all' ? projectFilter : undefined,
        statusFilter !== 'all' ? statusFilter : undefined,
        page,
        pageSize
      );
      setRecordings(response.recordings);
      setTotal(response.total);
    } catch (error: any) {
      console.error('Failed to load recordings:', error);
      toast.error('Failed to load recordings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecordings();
  }, [page, statusFilter, projectFilter]);

  // Filter recordings by search query
  const filteredRecordings = recordings.filter((recording) =>
    recording.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    recording.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    recording.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recording?')) {
      return;
    }

    try {
      await recordingService.deleteRecording(id);
      toast.success('Recording deleted');
      loadRecordings();
    } catch (error: any) {
      console.error('Failed to delete recording:', error);
      toast.error('Failed to delete recording');
    }
  };

  const handleStartProcessing = async (id: string) => {
    try {
      await recordingService.startProcessing(id);
      toast.success('Processing started');
      loadRecordings();
    } catch (error: any) {
      console.error('Failed to start processing:', error);
      toast.error('Failed to start processing');
    }
  };

  const getStatusIcon = (status: RecordingStatus) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'processing':
      case 'validating':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-gray-600" />;
      default:
        return <Clock className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: RecordingStatus) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
      case 'processing':
      case 'validating':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100';
      default:
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Recordings</h1>
          <p className="text-muted-foreground mt-2">
            Manage your annotated recordings and discovered state structures
          </p>
        </div>
        <Button onClick={() => router.push('/recordings/upload')}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Recording
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search recordings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Project Filter */}
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as RecordingStatus | 'all')}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="uploaded">Uploaded</SelectItem>
                <SelectItem value="validating">Validating</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Recording List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredRecordings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No recordings found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || statusFilter !== 'all' || projectFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Upload your first recording to get started'}
            </p>
            <Button onClick={() => router.push('/recordings/upload')}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Recording
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRecordings.map((recording) => (
            <Card key={recording.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getStatusIcon(recording.status)}
                      <CardTitle className="text-xl">{recording.name}</CardTitle>
                      <Badge className={getStatusColor(recording.status)}>
                        {RecordingStatusLabels[recording.status]}
                      </Badge>
                    </div>
                    {recording.description && (
                      <CardDescription>{recording.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/recordings/${recording.id}`)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {recording.status === 'uploaded' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartProcessing(recording.id)}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(recording.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Processing Progress */}
                  {(recording.status === 'processing' || recording.status === 'validating') && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {recording.processing_phase
                            ? ProcessingPhaseLabels[recording.processing_phase]
                            : 'Processing...'}
                        </span>
                        <span className="font-medium">
                          {Math.round(recording.processing_progress * 100)}%
                        </span>
                      </div>
                      <Progress value={recording.processing_progress * 100} />
                    </div>
                  )}

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Frames</p>
                      <p className="text-lg font-semibold">{recording.stats.total_frames}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Interactions</p>
                      <p className="text-lg font-semibold">{recording.stats.total_interactions}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="text-lg font-semibold">
                        {recording.stats.duration_seconds}s
                      </p>
                    </div>
                    {recording.status === 'completed' && (
                      <>
                        <div>
                          <p className="text-xs text-muted-foreground">States</p>
                          <p className="text-lg font-semibold">
                            {recording.stats.discovered_states}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Transitions</p>
                          <p className="text-lg font-semibold">
                            {recording.stats.discovered_transitions}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Tags and Confidence */}
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2 flex-wrap">
                      {recording.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {recording.confidence && (
                      <Badge className={getConfidenceColor(getConfidenceLevel(recording.confidence))}>
                        {Math.round(recording.confidence * 100)}% Confidence
                      </Badge>
                    )}
                  </div>

                  {/* Validation Errors/Warnings */}
                  {recording.validation_errors.length > 0 && (
                    <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                      <AlertCircle className="h-4 w-4 mt-0.5" />
                      <span>{recording.validation_errors.length} validation error(s)</span>
                    </div>
                  )}
                  {recording.validation_warnings.length > 0 && (
                    <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400">
                      <AlertCircle className="h-4 w-4 mt-0.5" />
                      <span>{recording.validation_warnings.length} warning(s)</span>
                    </div>
                  )}

                  {/* Timestamp */}
                  <p className="text-xs text-muted-foreground">
                    Created {formatDistanceToNow(new Date(recording.created_at), { addSuffix: true })}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex justify-center items-center gap-4 mt-8">
          <Button
            variant="outline"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / pageSize)}
          </span>
          <Button
            variant="outline"
            onClick={() => setPage(Math.min(Math.ceil(total / pageSize), page + 1))}
            disabled={page >= Math.ceil(total / pageSize)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
