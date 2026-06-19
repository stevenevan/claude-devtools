package filesservice

type FilesService struct{}

func (s *FilesService) Ready() (bool, error) { return true, nil }
