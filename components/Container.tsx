import { SafeAreaView } from 'react-native';

export const Container = ({
  children,
  className = '',
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  [key: string]: any;
}) => {
  return (
    <SafeAreaView className={className} {...props}>
      {children}
    </SafeAreaView>
  );
};

const styles = {
  container: 'flex flex-1 m-6',
};
