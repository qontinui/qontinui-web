'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ArrowLeft, Play, Trash2, CheckCircle } from 'lucide-react';
import { recordingService } from '@/services/service-factory';
import { ProcessingMonitor } from '@/components/recordings/ProcessingMonitor';
import { StateStructureReview } from '@/components/recordings/StateStructureReview';
import {
  RecordingStatusLabels,
  getConfidenceLevel,
  getConfidenceColor,
} from '@/types/recording';
import type { Recording } from '@/types/recording';
import { formatDistanceToNow } from 'date-fns';

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const recordingId = params.id as string;

  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    loadRecording();
  }, [recordingId]);

  const loadRecording = async () => {
    try {
      setLoading(true);
      const data = await recordingService.getRecording(recordingId);
      setRecording(data);

      // Auto-select appropriate tab based on status
      if (data.status === 'processing' || data.status === 'validating') {
        setActiveTab('processing');
      } else if (data.status === 'completed') {
        setActiveTab('review');
      }
    } catch (error: any) {
      console.error('Failed to load recording:', error);
      toast.error('Failed to load recording');
    } finally {
      setLoading(false);
    }
  };

  const handleStartProcessing = async () => {
    if (!recording) return;

    try {
      await recordingService.startProcessing(recordingId);
      toast.success('Processing started');
      setActiveTab('processing');
      loadRecording();
    } catch (error: any) {
      console.error('Failed to start processing:', error);
      toast.error('Failed to start processing');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this recording?')) {
      return;
    }

    try {
      await recordingService.deleteRecording(recordingId);
      toast.success('Recording deleted');
      router.push('/recordings');
    } catch (error: any) {
      console.error('Failed to delete recording:', error);
      toast.error('Failed to delete recording');
    }
  };

  const handleProcessingComplete = () => {
    toast.success('Processing completed!');
    setActiveTab('review');
    loadRecording();
  };

  const handleProcessingError = (error: string) => {
    toast.error(`Processing failed: ${error}`);
    loadRecording();
  };

  if (loading || !recording) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="h-8 w-8 animate-spin border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push('/recordings')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Recordings
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{recording.name}</h1>
              <Badge
                className={
                  recording.status === 'completed'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : recording.status === 'failed'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                    : recording.status === 'processing' || recording.status === 'validating'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
                    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100'
                }
              >
                {RecordingStatusLabels[recording.status]}
              </Badge>
              {recording.confidence && (
                <Badge className={getConfidenceColor(getConfidenceLevel(recording.confidence))}>
                  {Math.round(recording.confidence * 100)}% Confidence
                </Badge>
              )}
            </div>
            {recording.description && (
              <p className="text-muted-foreground">{recording.description}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              Created {formatDistanceToNow(new Date(recording.created_at), { addSuffix: true })}
            </p>
          </div>

          <div className="flex gap-2">
            {recording.status === 'uploaded' && (
              <Button onClick={handleStartProcessing}>
                <Play className="mr-2 h-4 w-4" />
                Start Processing
              </Button>
            )}
            <Button variant="outline" onClick={handleDelete} className="text-red-600">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger
            value="processing"
            disabled={
              recording.status !== 'processing' &&
              recording.status !== 'validating' &&
              recording.status !== 'completed' &&
              recording.status !== 'failed'
            }
          >
            Processing
          </TabsTrigger>
          <TabsTrigger value="review" disabled={recording.status !== 'completed'}>
            Review Structure
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Frames
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{recording.stats.total_frames}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Interactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{recording.stats.total_interactions}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Duration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{recording.stats.duration_seconds}s</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Frame Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{recording.stats.frame_rate} fps</p>
              </CardContent>
            </Card>
          </div>

          {recording.status === 'completed' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Discovered States
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-green-600">
                    {recording.stats.discovered_states}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Discovered Transitions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-blue-600">
                    {recording.stats.discovered_transitions}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Workflows Generated
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-purple-600">
                    {recording.stats.discovered_workflows}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tags */}
          {recording.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {recording.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Validation Issues */}
          {(recording.validation_errors.length > 0 || recording.validation_warnings.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Validation Issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {recording.validation_errors.length > 0 && (
                  <div>
                    <h4 className="font-medium text-red-600 mb-2">Errors</h4>
                    <ul className="space-y-1">
                      {recording.validation_errors.map((error, idx) => (
                        <li key={idx} className="text-sm text-red-600">
                          • {error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {recording.validation_warnings.length > 0 && (
                  <div>
                    <h4 className="font-medium text-yellow-600 mb-2">Warnings</h4>
                    <ul className="space-y-1">
                      {recording.validation_warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm text-yellow-600">
                          • {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Processing Tab */}
        <TabsContent value="processing" className="pt-6">
          <ProcessingMonitor
            recordingId={recordingId}
            onComplete={handleProcessingComplete}
            onError={handleProcessingError}
          />
        </TabsContent>

        {/* Review Tab */}
        <TabsContent value="review" className="pt-6">
          <div className="min-h-[600px]">
            <StateStructureReview recordingId={recordingId} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
